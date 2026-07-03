/**
 * Filter enabled tools by operating mode tool policy.
 */

import type { ToolDefinition } from '../../tools/definitions';
import { getMode } from './registry';
import type { ModeId, ToolPolicyAction } from './types';

/**
 * Resolve effective policy for a tool name (function name === tool id).
 * `ask` is treated as `deny` for API exposure in v1.
 */
function effectiveAction(
  modeId: ModeId,
  toolName: string,
): ToolPolicyAction {
  const policy = getMode(modeId).toolPolicy;
  const explicit = policy.tools?.[toolName];
  const action = explicit ?? policy.default;
  if (action === 'ask') return 'deny';
  return action;
}

/**
 * Returns tools still allowed for the model after mode policy is applied.
 */
export function filterToolsByMode(
  defs: ToolDefinition[],
  modeId: ModeId,
): ToolDefinition[] {
  return defs.filter((tool) => {
    const name = tool.definition.function.name;
    return isToolAllowedForMode(modeId, name);
  });
}

/**
 * Whether a tool function name may be sent to the model for this mode.
 * MCP and plugin tools use the same policy map as built-ins.
 */
export function isToolAllowedForMode(
  modeId: ModeId,
  toolName: string,
): boolean {
  return effectiveAction(modeId, toolName) === 'allow';
}
