import type { ToolDefinition } from '../../tools/definitions';
import { getMode } from './registry';
import type { ModeId, ToolPolicyAction } from './types';

/** MCP and native plugin tools are user-configured outside the built-in group matrix. */
export function isExternalDynamicTool(toolName: string): boolean {
  return toolName.startsWith('mcp__') || toolName.startsWith('plugin__');
}

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

export function isToolAllowedForMode(
  modeId: ModeId,
  toolName: string,
): boolean {
  if (isExternalDynamicTool(toolName)) return true;
  return effectiveAction(modeId, toolName) === 'allow';
}
