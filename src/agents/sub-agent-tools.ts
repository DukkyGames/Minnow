/**
 * Resolve which OpenAI tool definitions a sub-agent may call.
 */

import { applyEducationToolFilter } from '../chat/modes/education-overlay';
import { isEducationModeEnabledSync } from '../config/education-meta';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type { SubAgentTypeConfig } from './types';

const META_SPAWN_TOOLS = new Set([
  'spawn_sub_agent',
  'cancel_sub_agent',
  'list_sub_agents',
  'get_sub_agent_status',
]);

/**
 * Filter parent-enabled tools by sub-agent allow/deny lists.
 * Always removes recursive spawn tools unless type is reserved "orchestrator" (v1: never).
 *
 * The Education Mode filter runs last and cannot be undone by a type's
 * `allowedTools`. This path matters most: resolveSubAgentToolModeId silently
 * upgrades plan-family sub-agents to Build policy, so without it a student could
 * get code written simply by asking for a sub-agent.
 */
export function resolveSubAgentTools(
  typeConfig: SubAgentTypeConfig,
  typeId: string,
  parentEnabled: OpenAIFunctionDefinition[],
): OpenAIFunctionDefinition[] {
  let tools = [...parentEnabled];

  if (typeConfig.allowedTools && typeConfig.allowedTools.length > 0) {
    const allow = new Set(typeConfig.allowedTools);
    tools = tools.filter((t) => allow.has(t.function.name));
  }

  const deny = new Set([
    ...typeConfig.deniedTools,
    ...(typeId === 'orchestrator' ? [] : META_SPAWN_TOOLS),
  ]);
  tools = tools.filter((t) => !deny.has(t.function.name));

  return applyEducationToolFilter(isEducationModeEnabledSync(), tools);
}
