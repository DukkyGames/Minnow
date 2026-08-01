/**
 * Reconcile orchestrate boards when the display wakes (visibility / screen unlock).
 * Catches stream-end finalizers that did not run while the renderer was throttled.
 */

import { reportBackgroundError } from '../../boot/report-background-error.ts';
import { hasIncompleteOrchestrateWork } from './plan-complete.ts';
import { reconcileRunningBoardsAfterDisplayWake } from '../../state/orchestrate-board-actions.ts';
import { sessionState } from '../../state/sessions.ts';

/** Safety net when visibility / unlock IPC is missed during lock. */
const BOARD_LIVENESS_INTERVAL_MS = 20_000;

let wakeListenerBound = false;
let wakeReconcileInFlight: Promise<void> | null = null;
let boardLivenessTimer: ReturnType<typeof setInterval> | null = null;

function shouldRunBoardLivenessPoll(): boolean {
  const groups = sessionState?.groups;
  if (!groups?.length) return false;
  for (const group of groups) {
    const board = group.orchestrateBoard;
    if (!board || !hasIncompleteOrchestrateWork(board)) continue;
    if (board.autoRunning === true || board.systemPaused === true) return true;
  }
  return false;
}

function syncBoardLivenessPoll(): void {
  if (typeof window === 'undefined') return;
  if (shouldRunBoardLivenessPoll()) {
    if (boardLivenessTimer != null) return;
    boardLivenessTimer = setInterval(() => {
      scheduleBoardWakeReconcile(true);
    }, BOARD_LIVENESS_INTERVAL_MS);
    return;
  }
  if (boardLivenessTimer != null) {
    clearInterval(boardLivenessTimer);
    boardLivenessTimer = null;
  }
}

function scheduleBoardWakeReconcile(allowStalledRestart: boolean): void {
  if (wakeReconcileInFlight) return;
  wakeReconcileInFlight = reconcileRunningBoardsAfterDisplayWake({ allowStalledRestart })
    .catch((err) => reportBackgroundError('board-display-wake-reconcile', err))
    .finally(() => {
      wakeReconcileInFlight = null;
      syncBoardLivenessPoll();
    });
}

/** Register visibility (and optional Electron screen-unlock) wake hooks once at boot. */
export function initOrchestrateBoardDisplayWake(): void {
  if (wakeListenerBound || typeof document === 'undefined') return;
  wakeListenerBound = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    scheduleBoardWakeReconcile(false);
  });

  try {
    window.minnow?.power?.onScreenUnlocked?.(() => {
      scheduleBoardWakeReconcile(false);
    });
  } catch {
    /* browser / tests */
  }

  syncBoardLivenessPoll();
}

/** Test helper — run the same reconcile path as a visibility wake. */
export function reconcileBoardsAfterDisplayWakeForTests(): Promise<void> {
  return reconcileRunningBoardsAfterDisplayWake();
}

/** Test helper — stop the liveness interval. */
export function resetBoardDisplayWakeLivenessForTests(): void {
  if (boardLivenessTimer != null) {
    clearInterval(boardLivenessTimer);
    boardLivenessTimer = null;
  }
}
