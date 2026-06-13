/**
 * Blocks tool execution until the user approves (modal), when policy requires it.
 */

import { getWorkspaceLabel, getWorkspacePath } from '../state/workspace';
import { getToolSecurityMetaCached, loadToolSecurityMeta } from '../config/tool-security-meta';
import {
  loadToolConfig,
  saveToolConfigAsync,
  setAgentToolPermission,
  type ToolPermissionMode,
} from './config';
import { describeToolInvocation } from './describe-invocation';
import { extractPathLikeArgs } from './path-args';
import { isPathUnderWorkspace } from './workspace-path-guard';
import type { ToolExecutionResult } from '../types';
import { enqueueToolApproval, type ToolApprovalContext } from './approval-queue';
import type { ToolApprovalRequest } from './tool-approval-types';
import {
  formatApprovalPatternLabel,
  resolveEffectivePermission,
  resolveToolAgentKey,
} from './permission-resolve';

export type { ToolApprovalContext };

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
      ? pathStrings.filter((p) => !isPathUnderWorkspace(p, workspaceRoot))
      : [];

  const needsPathAck = pathsOutsideWorkspace.length > 0;
  const needsPermissionAck = perm === 'ask';
  if (!needsPathAck && !needsPermissionAck) {
    return null;
  }

  const summary = describeToolInvocation(execName, args);
  const workspace: ToolApprovalRequest['workspace'] = workspaceRoot
    ? { label: getWorkspaceLabel() || workspaceRoot, path: workspaceRoot }
    : {
        hint: 'Not loaded — start with npm start and choose a workspace folder.',
      };

  const pathWarning =
    needsPathAck && fsMeta.filesystemAccess === 'workspace'
      ? `${
          perm === 'full' ? 'Tool permission is Full, but these paths are outside the workspace:\n' : 'Paths outside the workspace:\n'
        }${pathsOutsideWorkspace.map((p) => `• ${p}`).join('\n')}\n\nThe server will reject these unless you enable full filesystem access in Settings.`
      : '';

  const agentKey = resolveToolAgentKey(context);
  const alwaysAllowScope: ToolApprovalRequest['alwaysAllowScope'] =
    agentKey === 'main' ? 'global' : 'agent';

  const decision = await enqueueToolApproval({
    toolName: execName,
    title: summary.title,
    description: summary.description,
    argsJson: summary.argsJson,
    workspace,
    pathWarning: pathWarning || undefined,
    subAgentType: context.subAgentType,
    workAgentId: context.workAgentId,
    agentKey,
    alwaysAllowScope,
    matchedPatternLabel:
      resolved.matchedPattern ?
        formatApprovalPatternLabel(resolved.matchedPattern)
      : undefined,
  });

  if (decision === 'cancel') {
    return { content: 'Error: User denied tool execution' };
  }

  if (decision === 'always-allow') {
    if (alwaysAllowScope === 'agent') {
      setAgentToolPermission(config, agentKey, permissionToolId, 'full');
    } else {
      config.permissions.default[permissionToolId] = 'full';
    }
    await saveToolConfigAsync(config);
  }

  return null;
}

/** Exposed for tests: whether this invocation would require a modal (ignores document). */
export function toolInvocationWouldPrompt(
  toolName: string,
  args: Record<string, unknown>,
  perm: ToolPermissionMode,
  filesystemAccess: 'workspace' | 'full',
  workspaceRoot: string,
): boolean {
  if (perm === 'off') return false;
  const pathStrings = extractPathLikeArgs(toolName, args);
  const needsPathAck =
    filesystemAccess === 'workspace' &&
    workspaceRoot.trim().length > 0 &&
    pathStrings.some((p) => !isPathUnderWorkspace(p, workspaceRoot));
  const needsPermissionAck = perm === 'ask';
  return needsPathAck || needsPermissionAck;
}
