/**
 * Blocks tool execution until the user approves (modal), when policy requires it.
 */

import { getWorkspaceLabel, getWorkspacePath } from '../state/workspace';
import { findChatById, isGoalLoopActive } from '../state/sessions';
import {
  getToolSecurityMetaCached,
  loadToolSecurityMeta,
  saveToolSecurityMeta,
} from '../config/tool-security-meta';
import {
  loadToolConfig,
  saveToolConfigAsync,
  type ToolPermissionMode,
} from './config';
import { describeToolInvocation } from './describe-invocation';
import { extractPathLikeArgs } from './path-args';
import { isPathUnderWorkspace } from './workspace-path-guard';
import { isCachedRegisteredWorktreePath } from '../lib/worktree-allowlist-client.ts';
import type { ToolExecutionResult } from '../types';
import { enqueueToolApproval, type ToolApprovalContext } from './approval-queue';
import type { ToolApprovalRequest } from './tool-approval-types';
import { resolveEffectivePermission } from './permission-resolve';
import { applyDestructiveConfirmationAfterUserApproval } from './destructive-tool-confirm';
import {
  ensureShellSandboxCaches,
  fetchSandboxStatus,
  resolveShellSandboxModeForChat,
  SHELL_SANDBOX_TOOL_IDS,
} from './shell-sandbox-client';

export type { ToolApprovalContext };

/**
 * V1 leftover boards used to skip permission prompts when they were AFK.
 * That distinction is gone (MIN-718): leftover Running is not a prompt policy.
 * Kept as a named no-op so existing call sites stay compile-clean.
 */
export function blockAfkInteractionAttempt(
  _context: ToolApprovalContext,
  _kind: 'question' | 'approval' | 'confirmation' | 'mode_switch' | 'other',
  _reason: string,
): ToolExecutionResult | null {
  return null;
}

const COMPANION_MUTATING_TOOLS = new Set([
  'write_clipboard',
  'save_file',
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'make_directory',
  'move_file',
  'copy_file',
  'delete_path',
  'create_pdf',
  'create_spreadsheet',
  'create_word_document',
  'git_add',
  'git_commit',
  'git_checkout',
  'git_branch',
  'execute_command',
  'stop_command',
  'start_background_command',
  'stop_background_command',
  'manage_dev_servers',
  'run_javascript',
  'run_python',
  'brain_write_page',
  'brain_append_log',
  'brain_ingest_source',
  'manage_brain',
  'update_settings',
  'update_appearance',
  'upload_appearance_asset',
  'save_memory',
  'manage_calendar',
  'draft_reply',
  'email_action',
]);

/** Whether a built-in mutation must always prompt from a companion device. */
export function companionToolRequiresApproval(toolId: string): boolean {
  return COMPANION_MUTATING_TOOLS.has(toolId);
}

function companionRequiresApproval(toolId: string): boolean {
  return (
    document.documentElement.classList.contains('minnow-companion') &&
    companionToolRequiresApproval(toolId)
  );
}

/** Matches server `resolveSafePath` rejection copy (`server/runtime/path-access.js`). */
export function outsideWorkspaceBlockMessage(userPath: string): string {
  return `Error: Path "${userPath}" resolves outside the workspace directory. Enable full disk access in Settings → General → Filesystem access (dangerous) to allow paths outside the workspace.`;
}

function isPathInAllowedRoots(
  userPath: string,
  workspaceRoot: string,
  extraRoots: string[] | undefined,
): boolean {
  if (isPathUnderWorkspace(userPath, workspaceRoot)) return true;
  if (isCachedRegisteredWorktreePath(userPath)) return true;
  for (const root of extraRoots ?? []) {
    const trimmed = root.trim();
    if (trimmed && isPathUnderWorkspace(userPath, trimmed)) return true;
  }
  return false;
}

/** Result of the pre-execution gate: proceed or return this tool message instead. */
export async function maybeBlockToolForUserApproval(
  permissionToolId: string,
  args: Record<string, unknown>,
  context: ToolApprovalContext,
  displayToolName?: string,
): Promise<ToolExecutionResult | null> {
  if (context.benchmarkAutonomous) {
    return null;
  }

  const config = loadToolConfig();
  const resolved = resolveEffectivePermission(config, permissionToolId, args, {
    subAgentType: context.subAgentType,
    workAgentId: context.workAgentId,
    modeId: context.modeId,
  });
  const perm = resolved.mode;
  if (perm === 'off') {
    return {
      content: `Error: tool "${displayToolName ?? permissionToolId}" is disabled in Settings (set permission to Ask or Full to use it).`,
    };
  }

  await loadToolSecurityMeta().catch(() => undefined);
  const fsMeta = getToolSecurityMetaCached();
  const workspaceRoot = context.workspaceRoot?.trim() || getWorkspacePath();
  const execName = displayToolName ?? permissionToolId;
  const pathStrings = extractPathLikeArgs(execName, args);
  const pathsOutsideWorkspace =
    fsMeta.filesystemAccess === 'workspace' && workspaceRoot.trim().length > 0
      ? pathStrings.filter(
          (p) => !isPathInAllowedRoots(p, workspaceRoot, context.extraPathRoots),
        )
      : [];

  const needsPathAck = pathsOutsideWorkspace.length > 0;
  // A device must approve each mutating call in the browser that initiated it,
  // even when the host's shared tool setting is Full.
  const needsCompanionAck = companionRequiresApproval(permissionToolId);
  const needsPermissionAck = perm === 'ask' || needsCompanionAck;

  if (needsPathAck || needsPermissionAck) {
    const afkBlocked = blockAfkInteractionAttempt(
      context,
      needsPathAck ? 'confirmation' : 'approval',
      needsPathAck
        ? `${execName} requested a path outside the allowed workspace`
        : `${execName} requires user approval`,
    );
    if (afkBlocked) return afkBlocked;

    // Server rejects out-of-workspace paths unless full filesystem access is on — do not modal.
    if (needsPathAck) {
      return { content: outsideWorkspaceBlockMessage(pathsOutsideWorkspace[0]!) };
    }

    let goalAutoApproved = false;
    if (needsPermissionAck && !needsCompanionAck && context.chatId) {
      const chat = findChatById(context.chatId);
      if (chat && isGoalLoopActive(chat)) {
        applyDestructiveConfirmationAfterUserApproval(permissionToolId, args);
        goalAutoApproved = true;
      }
    }

    if (!goalAutoApproved) {
      if (typeof document === 'undefined') {
        // Headless: cannot show Ask strip — still run sandbox escalation below for shell tools.
      } else {
        const summary = describeToolInvocation(execName, args);
        const workspace: ToolApprovalRequest['workspace'] = workspaceRoot
          ? { label: getWorkspaceLabel() || workspaceRoot, path: workspaceRoot }
          : {
              hint: 'Not loaded — open Minnow and choose a workspace folder.',
            };

        const decision = await enqueueToolApproval({
          toolName: execName,
          title: summary.title,
          description: summary.description,
          argsJson: summary.argsJson,
          workspace,
          subAgentType: context.subAgentType,
          workAgentId: context.workAgentId,
          signal: context.signal,
        });

        if (decision === 'cancel') {
          return { content: 'Error: User denied tool execution' };
        }

        if (decision === 'always-allow' && !needsCompanionAck) {
          config.permissions.default[permissionToolId] = 'full';
          await saveToolConfigAsync(config);
        }

        applyDestructiveConfirmationAfterUserApproval(permissionToolId, args);
      }
    }
  }

  // MIN-553 Phase 3: prefer → Ask to run unsandboxed; require → clear error (AFK fail-closed).
  if (SHELL_SANDBOX_TOOL_IDS.has(permissionToolId)) {
    const sandboxGate = await maybeEscalateShellSandbox(
      permissionToolId,
      args,
      context,
      execName,
    );
    if (sandboxGate) return sandboxGate;
  }

  return null;
}

/**
 * When shell sandbox mode is on but the OS backend is unavailable:
 * require → error; prefer → Ask strip (Allow once / Always allow / Cancel).
 */
async function maybeEscalateShellSandbox(
  permissionToolId: string,
  args: Record<string, unknown>,
  context: ToolApprovalContext,
  execName: string,
): Promise<ToolExecutionResult | null> {
  await ensureShellSandboxCaches().catch(() => undefined);
  const mode = resolveShellSandboxModeForChat(context.chatId);
  if (mode === 'off') return null;

  const status = await fetchSandboxStatus();
  const available = status?.available === true;
  if (available) return null;

  const detail =
    status?.detail?.trim() ||
    status?.reason?.trim() ||
    'Agent shell sandbox is not available on this platform';

  if (mode === 'require') {
    return {
      content:
        `Error: Agent shell sandbox is required but unavailable. ${detail}. ` +
        'Install/enable the platform sandbox, or change Agent shell sandbox / board sandbox mode.',
    };
  }

  // prefer — already always-allowed?
  if (getToolSecurityMetaCached().allowUnsandboxedShell || args.allow_unsandboxed === true) {
    args.allow_unsandboxed = true;
    return null;
  }

  const afkBlocked = blockAfkInteractionAttempt(
    context,
    'approval',
    `${execName} needs approval to run unsandboxed (sandbox unavailable)`,
  );
  if (afkBlocked) return afkBlocked;

  if (typeof document === 'undefined') {
    return {
      content:
        `Error: Agent shell sandbox unavailable (${detail}). ` +
        'Cannot prompt for unsandboxed approval in this context.',
    };
  }

  const workspaceRoot = context.workspaceRoot?.trim() || getWorkspacePath();
  const workspace: ToolApprovalRequest['workspace'] = workspaceRoot
    ? { label: getWorkspaceLabel() || workspaceRoot, path: workspaceRoot }
    : { hint: 'Not loaded — open Minnow and choose a workspace folder.' };

  const decision = await enqueueToolApproval({
    toolName: execName,
    title: 'Run unsandboxed?',
    description:
      `The agent shell sandbox is unavailable (${detail}). ` +
      'Allow this command to run without host filesystem containment?',
    argsJson: JSON.stringify(args, null, 2),
    workspace,
    subAgentType: context.subAgentType,
    workAgentId: context.workAgentId,
    signal: context.signal,
  });

  if (decision === 'cancel') {
    return { content: 'Error: User denied unsandboxed shell execution' };
  }

  if (decision === 'always-allow') {
    await saveToolSecurityMeta({ allowUnsandboxedShell: true }).catch(() => undefined);
  }

  args.allow_unsandboxed = true;
  return null;
}

/** Exposed for tests: whether this invocation would require a modal (ignores document). */
export function toolInvocationWouldPrompt(
  toolName: string,
  args: Record<string, unknown>,
  perm: ToolPermissionMode,
  filesystemAccess: 'workspace' | 'full',
  workspaceRoot: string,
  extraPathRoots: string[] = [],
): boolean {
  if (perm === 'off') return false;
  const pathStrings = extractPathLikeArgs(toolName, args);
  const pathsOutsideWorkspace =
    filesystemAccess === 'workspace' && workspaceRoot.trim().length > 0
      ? pathStrings.filter(
          (p) => !isPathInAllowedRoots(p, workspaceRoot, extraPathRoots),
        )
      : [];
  const needsPermissionAck = perm === 'ask';
  // Out-of-workspace paths are blocked before the modal when FS access is workspace-only.
  return needsPermissionAck && pathsOutsideWorkspace.length === 0;
}
