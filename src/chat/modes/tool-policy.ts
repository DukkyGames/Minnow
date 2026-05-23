/**
 * Filter enabled tools by operating mode tool policy.
 */

import type { ToolDefinition } from '../../tools/definitions';
import { getMode } from './registry';
import type { ModeId, ToolPolicyAction } from './types';

/** Bug tracker tools are UI-only on the global #/bugs screen, not in chat. */
const GLOBAL_BUG_TOOL_IDS = new Set(['bug_add', 'bug_update', 'bug_get_state']);

/**
 * Resolve effective policy for a tool name (function name === tool id).
 * `ask` is treated as `deny` for API exposure in v1.
 */
function effectiveAction(
  modeId: ModeId,
  toolName: string,
): ToolPolicyAction {
  if (GLOBAL_BUG_TOOL_IDS.has(toolName)) return 'deny';
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
    return effectiveAction(modeId, name) === 'allow';
  });
}
