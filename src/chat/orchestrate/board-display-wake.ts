/**
 * Reconcile orchestrate boards when the display wakes (visibility / screen unlock).
 * Catches stream-end finalizers that did not run while the renderer was throttled.
 */

import { reportBackgroundError } from '../../boot/report-background-error.ts';
import { reconcileRunningBoardsAfterDisplayWake } from '../../state/orchestrate-board-actions.ts';

let wakeListenerBound = false;
let wakeReconcileInFlight: Promise<void> | null = null;

function scheduleBoardWakeReconcile(): void {
  if (wakeReconcileInFlight) return;
  wakeReconcileInFlight = reconcileRunningBoardsAfterDisplayWake()
    .catch((err) => reportBackgroundError('board-display-wake-reconcile', err))
    .finally(() => {
      wakeReconcileInFlight = null;
    });
}

/** Register visibility (and optional Electron screen-unlock) wake hooks once at boot. */
export function initOrchestrateBoardDisplayWake(): void {
  if (wakeListenerBound || typeof document === 'undefined') return;
  wakeListenerBound = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    scheduleBoardWakeReconcile();
  });

  try {
    window.minnow?.power?.onScreenUnlocked?.(() => {
      scheduleBoardWakeReconcile();
    });
  } catch {
    /* browser / tests */
  }
}

/** Test helper — run the same reconcile path as a visibility wake. */
export function reconcileBoardsAfterDisplayWakeForTests(): Promise<void> {
  return reconcileRunningBoardsAfterDisplayWake();
}
