/**
 * Orchestrate auto-pilot tool gating (delegate_tasks).
 */

import type { OpenAIFunctionDefinition } from '../../tools/definitions';

/** Hide delegate_tasks unless the board is in auto-pilot mode. */
export function applyOrchestrateAutoToolFilter(
  defs: OpenAIFunctionDefinition[],
  executionMode: 'manual' | 'auto' | undefined,
): OpenAIFunctionDefinition[] {
  const autoPilot = executionMode === 'auto';
  return defs.filter((def) => {
    if (def.function.name === 'delegate_tasks') return autoPilot;
    return true;
  });
}
