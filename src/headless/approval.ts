/**
 * Headless CLI tool approval — explicit deny on "ask" unless --no-approval + env opt-in.
 */

import { loadToolConfig } from '../tools/config';
import type { ToolApprovalContext } from '../tools/permission-gate';
import { resolveEffectivePermission } from '../tools/permission-resolve';
import type { ToolExecutionResult } from '../types';
import type { ToolPermissionMode } from '../tools/tool-settings-types';

/** Env var required with --no-approval (documented in CLI --help). */
export const UNSAFE_AUTOMATION_ENV = 'MINNOW_I_UNDERSTAND_UNSAFE_AUTOMATION';

export interface HeadlessApprovalOptions {
  /** When true, tools with permission "ask" may run if env is set. */
  noApproval: boolean;
}

/**
 * Returns a tool result to short-circuit execution, or null to proceed.
 * Unlike browser permission-gate, never auto-allows "ask" when document is missing.
 */
export function maybeBlockHeadlessToolApproval(
  permissionToolId: string,
  args: Record<string, unknown>,
  context: ToolApprovalContext,
  options: HeadlessApprovalOptions,
  displayToolName?: string,
): ToolExecutionResult | null {
  const config = loadToolConfig();
  const resolved = resolveEffectivePermission(config, permissionToolId, args, {
    subAgentType: context.subAgentType,
    workAgentId: context.workAgentId,
    modeId: context.modeId,
  });
  const perm: ToolPermissionMode = resolved.mode;
  const execName = displayToolName ?? permissionToolId;

  if (perm === 'off') {
    return {
      content: `Error: tool "${execName}" is disabled in Settings (set permission to Ask or Full to use it).`,
    };
  }

  if (perm !== 'ask') {
    return null;
  }

  if (!options.noApproval) {
    return {
      content:
        `Error: tool "${execName}" requires user approval in non-interactive mode. ` +
        'Pass --no-approval only with explicit risk acceptance, or set the tool to Full in Settings.',
    };
  }

  if (process.env[UNSAFE_AUTOMATION_ENV] !== '1') {
    return {
      content:
        `Error: --no-approval requires ${UNSAFE_AUTOMATION_ENV}=1 in the environment.`,
    };
  }

  return null;
}

/** Whether this permission mode would block in default headless (no --no-approval). */
export function headlessWouldBlockPermission(perm: ToolPermissionMode): boolean {
  return perm === 'ask' || perm === 'off';
}
