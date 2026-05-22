/**
 * Self-healing controller — delegated to the Orchestrate supervisor (repetition / budgets).
 */

import type { ToolCallLogEntry } from './detector';
import { observeSubAgentToolCall as observeSupervisor } from '../supervisor/observe-sub-agent.ts';
import { resetSupervisorStateForTests } from '../supervisor/state.ts';

/**
 * Observe a sub-agent tool call; may cancel/restart on repetition when enabled in supervisor settings.
 */
export function observeSubAgentToolCall(
  runId: string,
  subAgentType: string,
  log: ToolCallLogEntry[],
  parentChatId?: string | null,
): void {
  observeSupervisor(runId, subAgentType, log, parentChatId);
}

/** Reset supervisor maps (tests). */
export function resetSelfHealingState(): void {
  resetSupervisorStateForTests();
}
