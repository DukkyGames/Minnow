/**
 * Blocks tool execution until the user approves (modal), when policy requires it.
 */

import { getWorkspaceLabel, getWorkspacePath } from '../state/workspace';
import { findChatById, isGoalLoopActive } from '../state/sessions';
import { getToolSecurityMetaCached, loadToolSecurityMeta } from '../config/tool-security-meta';
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

export type { ToolApprovalContext };

/** Matches server `resolveSafePath` rejection copy (`server/runtime/path-access.js`). */
export function outsideWorkspaceBlockMessage(userPath: string): string {
  return `Error: Path "${userPath}" resolves outside the workspace directory. Enable full filesystem access in Settings (dangerous) or set TOOLS_ALLOW_ALL_PATHS=1 for automation.`;
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

  if (typeof document === 'undefined') {
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
  const needsPermissionAck = perm === 'ask';
  if (!needsPathAck && !needsPermissionAck) {
    return null;
  }

  // Auto-approve while a /goal loop is active on this chat (hands-free until goal clears).
  if (needsPermissionAck && context.chatId) {
    const chat = findChatById(context.chatId);
    if (chat && isGoalLoopActive(chat)) {
      applyDestructiveConfirmationAfterUserApproval(permissionToolId, args);
      return null;
    }
  }

  // Server rejects out-of-workspace paths unless full filesystem access is on — do not modal.
  if (needsPathAck) {
    return { content: outsideWorkspaceBlockMessage(pathsOutsideWorkspace[0]!) };
  }

  const summary = describeToolInvocation(execName, args);
  const workspace: ToolApprovalRequest['workspace'] = workspaceRoot
    ? { label: getWorkspaceLabel() || workspaceRoot, path: workspaceRoot }
    : {
        hint: 'Not loaded — start with npm start and choose a workspace folder.',
      };

  const decision = await enqueueToolApproval({
    toolName: execName,
    title: summary.title,
    description: summary.description,
    argsJson: summary.argsJson,
    workspace,
    subAgentType: context.subAgentType,
    workAgentId: context.workAgentId,
  });

  if (decision === 'cancel') {
    return { content: 'Error: User denied tool execution' };
  }

  if (decision === 'always-allow') {
    config.permissions.default[permissionToolId] = 'full';
    await saveToolConfigAsync(config);
  }

  // Ask-strip approval satisfies server confirmed gates (manage_brain, manage_calendar delete, …).
  applyDestructiveConfirmationAfterUserApproval(permissionToolId, args);

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
