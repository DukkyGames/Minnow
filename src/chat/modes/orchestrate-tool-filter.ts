/**
 * Orchestrate auto-pilot tool gating (delegate_tasks).
 */

import type { OpenAIFunctionDefinition } from '../../tools/definitions';

/** Hide delegate_tasks from the planner LLM — auto-pilot delegates programmatically. */
export function applyOrchestrateAutoToolFilter(
  defs: OpenAIFunctionDefinition[],
  _executionMode: 'manual' | 'auto' | undefined,
): OpenAIFunctionDefinition[] {
  return defs.filter((def) => def.function.name !== 'delegate_tasks');
}
