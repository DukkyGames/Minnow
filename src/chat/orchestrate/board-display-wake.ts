/**
 * Reconcile orchestrate boards when the display wakes (visibility / screen unlock).
 * Catches stream-end finalizers that did not run while the renderer was throttled.
 */

import { reportBackgroundError } from '../../boot/report-background-error.ts';
import { hasIncompleteOrchestrateWork } from './plan-complete.ts';
import { isOomPauseActive } from './oom-recovery.ts';
import { isResumeGateHeld } from '../resume-gate.ts';
import { reconcileRunningBoardsAfterDisplayWake } from '../../state/orchestrate-board-actions.ts';
import { sessionState } from '../../state/sessions.ts';

/** Safety net when visibility / unlock IPC is missed during lock. */
const BOARD_LIVENESS_INTERVAL_MS = 20_000;

/**
 * How long a task chat must be silent before this poll may treat it as stalled.
 *
 * The poll is a backstop for a wake notification that never arrived, not a
 * supervisor — stall detection proper belongs to the heartbeat. Without a quiet
 * period it fired every 20s regardless of what the chats were doing and walked
 * live Builders through nudge → nudge → fail → quarantine in about a minute.
 * Comfortably longer than a slow tool round; the supervision clock this is
 * measured against freezes while the display is asleep.
 */
const BOARD_LIVENESS_MIN_QUIET_MS = 180_000;

let wakeListenerBound = false;
let wakeReconcileInFlight: Promise<void> | null = null;
let boardLivenessTimer: ReturnType<typeof setInterval> | null = null;

function shouldRunBoardLivenessPoll(): boolean {
  const groups = sessionState?.groups;
  if (!groups?.length) return false;
  // Boot resume prompt unanswered (or declined): nothing may be re-armed, so a
  // 20s timer would only spin with nothing to reconcile.
  if (isResumeGateHeld()) return false;
  // A board paused after an OOM crash waits for the user to press Start; polling
  // it forever would spin a wake every 20s with nothing to reconcile.
  const oomPaused = isOomPauseActive();
  for (const group of groups) {
    const board = group.orchestrateBoard;
    if (!board || !hasIncompleteOrchestrateWork(board)) continue;
    if (board.autoRunning === true) return true;
    if (board.systemPaused === true && !oomPaused) return true;
  }
  return false;
}

function syncBoardLivenessPoll(): void {
  if (typeof window === 'undefined') return;
  if (shouldRunBoardLivenessPoll()) {
    if (boardLivenessTimer != null) return;
    boardLivenessTimer = setInterval(() => {
      scheduleBoardWakeReconcile(true, BOARD_LIVENESS_MIN_QUIET_MS);
    }, BOARD_LIVENESS_INTERVAL_MS);
    return;
  }
  if (boardLivenessTimer != null) {
    clearInterval(boardLivenessTimer);
    boardLivenessTimer = null;
  }
}

function scheduleBoardWakeReconcile(
  allowStalledRestart: boolean,
  minQuietMs = 0,
): void {
  if (wakeReconcileInFlight) return;
  wakeReconcileInFlight = reconcileRunningBoardsAfterDisplayWake({
    allowStalledRestart,
    minQuietMs,
  })
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

/**
 * Re-evaluate the liveness poll after the boot resume gate resolves.
 *
 * `initOrchestrateBoardDisplayWake` runs while the prompt is still up, when the
 * hold keeps the poll off; without this the poll would stay off for the rest of
 * the session even after the user chose Resume.
 */
export function syncBoardLivenessPollAfterResumeGate(): void {
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
