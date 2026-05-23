/**
 * Supervisor tick loop: multi-chat orchestrate scans every ~5s plus event hooks.
 */

import { normalizeModeId } from '../../chat/modes/types.ts';
import { isChatStreaming } from '../../chat/streaming-state.ts';
import { subscribeBoardChanges } from '../../state/orchestrate-board-events.ts';
import { findChatById, getChatsSortedByUpdatedDesc } from '../../state/sessions.ts';
import type { Chat } from '../../types.ts';
import { listActiveSubAgentRuns } from '../orchestrator.ts';
import type { SubAgentRun } from '../types.ts';
import { subscribeSubAgentRuns } from '../sub-agent-events.ts';
import { executeSupervisorDecision } from './actions.ts';
import { loadSupervisorConfig, getSupervisorConfigSnapshot } from './config.ts';
import { detectEmptyCompletedSummary, type DetectorContext } from './detector.ts';
import { bumpOrchestratorProgress, recordParentStreamEnded } from './progress.ts';
import { isOrchestratePlanComplete } from '../../chat/orchestrate/plan-complete.ts';
import { isUserStoppedChat } from '../../chat/orchestrate/user-stopped.ts';
import { maybeEmitOrchestratePlanComplete } from '../../chat/orchestrate/plan-complete-ui.ts';
import { pickSupervisorDecision, scanTickDetectors, boardFingerprint } from './rules.ts';
import {
  deleteRunHealth,
  getRunHealth,
  getSupervisorChatState,
  markChatStalledForUi,
  pruneStaleStallUiFlag,
  resetSupervisorStateForTests,
  touchInProgressNoRunTracking,
} from './state.ts';

let tickTimer: ReturnType<typeof setInterval> | null = null;
let unsubAgents: (() => void) | null = null;
const boardUnsubs = new Map<string, () => void>();
const lastBoardFp = new Map<string, string>();

function isTerminalStatus(status: SubAgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function ensureBoardListener(chatId: string): void {
  if (boardUnsubs.has(chatId)) return;
  const unsub = subscribeBoardChanges(chatId, () => {
    const chat = findChatById(chatId);
    const board = chat?.orchestrateBoard;
    if (!chat || !board) return;
    const now = Date.now();
    bumpOrchestratorProgress(chatId, now);
    const fp = boardFingerprint(board);
    const prev = lastBoardFp.get(chatId);
    if (prev !== fp) {
      lastBoardFp.set(chatId, fp);
      for (const t of board.tasks) {
        touchInProgressNoRunTracking(chatId, t.id, t.status, t.assignedRunId, now);
      }
      if (isOrchestratePlanComplete(board)) {
        void maybeEmitOrchestratePlanComplete(chatId);
      }
    }
  });
  boardUnsubs.set(chatId, unsub);
}

function removeBoardListener(chatId: string): void {
  boardUnsubs.get(chatId)?.();
  boardUnsubs.delete(chatId);
  lastBoardFp.delete(chatId);
  markChatStalledForUi(chatId, false);
}

function recordSubAgentTerminal(run: SubAgentRun): void {
  if (!isTerminalStatus(run.status)) return;
  const chatId = run.parentChatId?.trim();
  if (!chatId) return;
  const now = Date.now();
  const sup = getSupervisorChatState(chatId);
  sup.lastTerminalAt = now;
  markChatStalledForUi(chatId, false);
  bumpOrchestratorProgress(chatId, now);
  const hit = detectEmptyCompletedSummary(run);
  const parent = run.parentChatId ? findChatById(run.parentChatId) : undefined;
  if (hit && run.parentChatId && parent && !isUserStoppedChat(parent)) {
    void executeSupervisorDecision(run.parentChatId, {
      action: 'respawn_task',
      rule: 'R2',
      payload: {
        runId: run.runId,
        boardTaskId: run.boardTaskId,
        type: run.type,
        category: run.category,
        task: run.task,
      },
    });
  }
  deleteRunHealth(run.runId);
}

async function tickSupervisor(): Promise<void> {
  await loadSupervisorConfig();
  const cfg = getSupervisorConfigSnapshot();
  const nowMs = Date.now();

  let chats: Chat[];
  try {
    chats = getChatsSortedByUpdatedDesc();
  } catch {
    return;
  }

  for (const chat of chats) {
    if (normalizeModeId(chat.modeId) !== 'orchestrate' || !chat.orchestrateBoard) {
      removeBoardListener(chat.id);
      continue;
    }
    ensureBoardListener(chat.id);
    const board = chat.orchestrateBoard;
    const sup = getSupervisorChatState(chat.id);
    const streaming = isChatStreaming(chat.id);
    const activeRunCount = listActiveSubAgentRuns().filter(
      (r) =>
        r.parentChatId === chat.id &&
        (r.status === 'queued' || r.status === 'running'),
    ).length;
    pruneStaleStallUiFlag(chat.id, board, { isStreaming: streaming, activeRunCount });
    if (streaming) {
      bumpOrchestratorProgress(chat.id, nowMs);
      markChatStalledForUi(chat.id, false);
    }
    const was = sup.wasStreaming === true;
    sup.wasStreaming = streaming;
    if (was && !streaming) {
      recordParentStreamEnded(chat.id, nowMs);
    }

    for (const t of board.tasks) {
      touchInProgressNoRunTracking(chat.id, t.id, t.status, t.assignedRunId, nowMs);
    }

    for (const r of listActiveSubAgentRuns()) {
      if (r.parentChatId !== chat.id) continue;
      if (r.status === 'queued') {
        const h = getRunHealth(r.runId);
        h.queuedSinceAt ??= nowMs;
      }
    }

    if (isOrchestratePlanComplete(board)) {
      void maybeEmitOrchestratePlanComplete(chat.id);
    }

    if (!cfg.enabled) continue;
    if (sup.awaitingUserDecision || sup.recoveryInFlight) continue;

    const ctx: DetectorContext = {
      nowMs,
      cfg,
      chat,
      board,
      sup,
      listRuns: listActiveSubAgentRuns,
      isStreaming: isChatStreaming,
    };

    const hit = scanTickDetectors(ctx);
    if (!hit) continue;
    const decision = pickSupervisorDecision(ctx, hit);
    if (decision.action === 'none') continue;
    sup.recoveryInFlight = true;
    try {
      await executeSupervisorDecision(chat.id, decision);
    } finally {
      sup.recoveryInFlight = false;
    }
  }
}

/** Start global supervisor loop (idempotent). */
export function startSupervisor(): void {
  if (tickTimer) return;
  unsubAgents = subscribeSubAgentRuns(recordSubAgentTerminal);
  const ms = getSupervisorConfigSnapshot().tickIntervalMs;
  tickTimer = setInterval(() => {
    void tickSupervisor();
  }, ms);
}

/** Stop supervisor (tests). */
export function stopSupervisor(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  unsubAgents?.();
  unsubAgents = null;
  for (const u of boardUnsubs.values()) u();
  boardUnsubs.clear();
  lastBoardFp.clear();
  resetSupervisorStateForTests();
}

/** Compatibility alias for legacy watchdog boot. */
export const startOrchestrateWatchdog = startSupervisor;
export const stopOrchestrateWatchdog = stopSupervisor;

/** Test hook: seed last terminal timestamp for a chat (watchdog parity). */
export function setWatchdogLastTerminalForTests(chatId: string, atMs: number | null): void {
  const sup = getSupervisorChatState(chatId);
  if (atMs == null) {
    delete sup.lastTerminalAt;
  } else {
    sup.lastTerminalAt = atMs;
  }
}
