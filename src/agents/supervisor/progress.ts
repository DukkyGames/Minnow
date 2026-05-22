/**
 * Centralized updates for the orchestrator “progress” clock (R7) and parent tool timestamps (R4).
 */

import { getSupervisorChatState } from './state.ts';

/** Any non-report progress signal resets the R7 idle clock. */
export function bumpOrchestratorProgress(chatId: string, nowMs: number = Date.now()): void {
  const sup = getSupervisorChatState(chatId);
  sup.lastOrchestratorProgressAt = Math.max(sup.lastOrchestratorProgressAt ?? 0, nowMs);
}

/** Record that an orchestrate parent tool returned a result to the model. */
export function recordParentToolResult(chatId: string, nowMs: number = Date.now()): void {
  const sup = getSupervisorChatState(chatId);
  sup.lastParentToolResultAt = nowMs;
  bumpOrchestratorProgress(chatId, nowMs);
}

/** Record that parent streaming for this chat just ended (R4). */
export function recordParentStreamEnded(chatId: string, nowMs: number = Date.now()): void {
  const sup = getSupervisorChatState(chatId);
  sup.lastParentStreamEndedAt = nowMs;
}
