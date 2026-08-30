/**
 * Sub-agent terminal outcome helpers (max tool turns vs real success).
 */
import type { SubAgentRun } from '../../src/agents/types.js';
/** Settled run `error` when the tool loop hits maxToolTurns without a final answer. */
export declare const SUB_AGENT_MAX_TOOL_TURNS_ERROR = "maximum tool turns reached";
/** Settled run `error` when input context could not fit under maxInputTokens. */
export declare const SUB_AGENT_CONTEXT_BUDGET_ERROR = "context budget exceeded";
/** True when summary text indicates the runner hit the tool-turn cap. */
export declare function isMaxToolTurnSummary(summary: string): boolean;
/** True when a settled run failed because of tool-turn exhaustion (not real completion). */
export declare function isMaxToolTurnFailure(summary: string, error: string | null): boolean;
/** True when the runner could not recover context under the token cap. */
export declare function isContextBudgetFailure(error: string | null): boolean;
/** True only for a genuine completed sub-agent run (excludes max-turn false positives). */
export declare function isSubAgentRunSuccessful(run: SubAgentRun): boolean;
/** True when a sub-agent run has reached a terminal status (settled). */
export declare function isSubAgentRunTerminal(status: SubAgentRun['status']): boolean;
