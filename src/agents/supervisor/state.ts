/**
 * In-memory supervisor maps: per-chat orchestration health and per-run tool heuristics.
 */

import {
  hasIncompleteOrchestrateWork,
  isOrchestratePlanComplete,
} from '../../chat/orchestrate/plan-complete.ts';
import type { OrchestrateBoardState } from '../../types.ts';
import type { OrchestratorStatusReport } from './report-types.ts';

/** Health for one sub-agent run (repetition + silence detectors). */
export interface SupervisorRunHealth {
  runId: string;
  lastToolCallAt?: number;
  /** Restarts triggered by supervisor R1/R3 (not total run count). */
  restartCount: number;
  repetitionFingerprints: Set<string>;
  /** When this run entered `queued` status (for R5). */
  queuedSinceAt?: number;
}

/** Mutable supervisor state for one orchestrate chat. */
export interface SupervisorChatState {
  chatId: string;
  lastReportAt?: number;
  lastReport?: OrchestratorStatusReport;
  /** Last sub-agent terminal event timestamp (watchdog parity / R8). */
  lastTerminalAt?: number;
  /** Last orchestrate parent tool result delivered to the model (R4). */
  lastParentToolResultAt?: number;
  /** When parent streaming last ended for this chat (R4). */
  lastParentStreamEndedAt?: number;
  /** Combined “progress” clock for R7 (report + board + subs + stream). */
  lastOrchestratorProgressAt?: number;
  /** Last tick we observed parent streaming on for edge detection. */
  wasStreaming?: boolean;
  awaitingUserDecision: boolean;
  recoveryInFlight: boolean;
  llmEscalationsThisSession: number;
  stalledForUi: boolean;
  /** Respawns issued for empty-summary recovery (R2), keyed by board task id. */
  spawnCountByTaskId: Map<string, number>;
  /** R5: one respawn attempt per task per stuck episode. */
  spawnRetryIssuedForTaskId: Set<string>;
  /** Set when every board task reaches `complete` (suppresses auto-resume). */
  planCompletedAt?: number;
  /** Completion summary was appended to chat history (once per chat). */
  completionMessageShown?: boolean;
}

const chatStates = new Map<string, SupervisorChatState>();
const runHealth = new Map<string, SupervisorRunHealth>();
const stalledChatIds = new Set<string>();
/** Chats that already showed the stall resume toast for the current episode. */
const watchdogToastShownForChat = new Set<string>();
/** Tracks `chatId::taskId` first seen in `in_progress` without `assignedRunId` (R6). */
const inProgressNoRunSince = new Map<string, number>();

function keyInProgress(chatId: string, taskId: string): string {
  return `${chatId}::${taskId}`;
}

export function getStalledChatIdsForTests(): Set<string> {
  return stalledChatIds;
}

export function markChatStalledForUi(chatId: string, stalled: boolean): void {
  const sup = getSupervisorChatState(chatId);
  if (stalled) {
    stalledChatIds.add(chatId);
    sup.stalledForUi = true;
  } else {
    stalledChatIds.delete(chatId);
    sup.stalledForUi = false;
    watchdogToastShownForChat.delete(chatId);
  }
}

/** Begin a new stall episode (allows one resume toast again). */
export function beginOrchestrateStallEpisode(chatId: string): void {
  watchdogToastShownForChat.delete(chatId);
}

export function shouldShowOrchestrateWatchdogToast(chatId: string): boolean {
  return !watchdogToastShownForChat.has(chatId);
}

export function markOrchestrateWatchdogToastShown(chatId: string): void {
  watchdogToastShownForChat.add(chatId);
}

export function isChatStalledForUi(chatId: string): boolean {
  return stalledChatIds.has(chatId);
}

/** Drop sticky stall UI when the orchestrator is idle or the plan finished. */
export function pruneStaleStallUiFlag(
  chatId: string,
  board: OrchestrateBoardState | undefined,
  opts: { isStreaming: boolean; activeRunCount: number },
): void {
  if (!stalledChatIds.has(chatId)) return;
  if (!board || isOrchestratePlanComplete(board) || !hasIncompleteOrchestrateWork(board)) {
    markChatStalledForUi(chatId, false);
    return;
  }
  if (opts.isStreaming || opts.activeRunCount > 0) {
    markChatStalledForUi(chatId, false);
  }
}

/** True when the board should show the red Stalled badge (runtime-gated). */
export function shouldShowOrchestrateStallBadge(
  chatId: string,
  board: OrchestrateBoardState,
  opts: { isStreaming: boolean; activeRunCount: number },
): boolean {
  pruneStaleStallUiFlag(chatId, board, opts);
  if (!isChatStalledForUi(chatId)) return false;
  if (opts.isStreaming || opts.activeRunCount > 0) return false;
  return hasIncompleteOrchestrateWork(board);
}

export function getSupervisorChatState(chatId: string): SupervisorChatState {
  let row = chatStates.get(chatId);
  if (!row) {
    row = {
      chatId,
      awaitingUserDecision: false,
      recoveryInFlight: false,
      llmEscalationsThisSession: 0,
      stalledForUi: false,
      spawnCountByTaskId: new Map(),
      spawnRetryIssuedForTaskId: new Set(),
    };
    chatStates.set(chatId, row);
  }
  return row;
}

export function getRunHealth(runId: string): SupervisorRunHealth {
  let row = runHealth.get(runId);
  if (!row) {
    row = { runId, restartCount: 0, repetitionFingerprints: new Set() };
    runHealth.set(runId, row);
  }
  return row;
}

export function deleteRunHealth(runId: string): void {
  runHealth.delete(runId);
}

export function clearInProgressTrackingForChat(chatId: string): void {
  for (const k of [...inProgressNoRunSince.keys()]) {
    if (k.startsWith(`${chatId}::`)) inProgressNoRunSince.delete(k);
  }
}

export function touchInProgressNoRunTracking(
  chatId: string,
  taskId: string,
  status: string,
  assignedRunId: string | undefined,
  nowMs: number,
): void {
  const k = keyInProgress(chatId, taskId);
  if (status === 'in_progress' && !assignedRunId?.trim()) {
    if (!inProgressNoRunSince.has(k)) inProgressNoRunSince.set(k, nowMs);
  } else {
    inProgressNoRunSince.delete(k);
  }
}

export function getInProgressNoRunSince(chatId: string, taskId: string): number | undefined {
  return inProgressNoRunSince.get(keyInProgress(chatId, taskId));
}

export function resetSupervisorStateForTests(): void {
  chatStates.clear();
  runHealth.clear();
  stalledChatIds.clear();
  watchdogToastShownForChat.clear();
  inProgressNoRunSince.clear();
}
