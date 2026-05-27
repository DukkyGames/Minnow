/**
 * Sub-agent terminal outcome helpers (max tool turns vs real success).
 */

import type { SubAgentRun } from './types';

/** Settled run `error` when the tool loop hits maxToolTurns without a final answer. */
export const SUB_AGENT_MAX_TOOL_TURNS_ERROR = 'maximum tool turns reached';

/** Settled run `error` when input context could not fit under maxInputTokens. */
export const SUB_AGENT_CONTEXT_BUDGET_ERROR = 'context budget exceeded';

/** True when summary text indicates the runner hit the tool-turn cap. */
export function isMaxToolTurnSummary(summary: string): boolean {
  return /maximum tool turns/i.test(summary);
}

/** True when a settled run failed because of tool-turn exhaustion (not real completion). */
export function isMaxToolTurnFailure(summary: string, error: string | null): boolean {
  if (error === SUB_AGENT_MAX_TOOL_TURNS_ERROR) return true;
  return isMaxToolTurnSummary(summary);
}

/** True when the runner could not recover context under the token cap. */
export function isContextBudgetFailure(error: string | null): boolean {
  return error === SUB_AGENT_CONTEXT_BUDGET_ERROR;
}

/** True only for a genuine completed sub-agent run (excludes max-turn false positives). */
export function isSubAgentRunSuccessful(run: SubAgentRun): boolean {
  if (run.status !== 'completed') return false;
  return !isMaxToolTurnFailure(run.summary, run.error);
}

/** True when a sub-agent run has reached a terminal status (settled). */
export function isSubAgentRunTerminal(status: SubAgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
