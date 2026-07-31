/**
 * Electron power-save guard while orchestrate boards are in AFK/auto run mode.
 */

import type { SessionState } from '../../types.ts';
import { isBoardRunning } from '../../state/orchestrate-board-store.ts';

let runningBoardRefCount = 0;

function applyPowerGuard(): void {
  try {
    window.minnow?.power?.setAfkBoardGuard?.(runningBoardRefCount > 0);
  } catch {
    /* desktop-only; no-op in browser */
  }
}

/** Call when a board transitions from stopped → running. */
export function onBoardAutoRunStarted(): void {
  runningBoardRefCount += 1;
  applyPowerGuard();
}

/** Call when a board transitions from running → stopped. */
export function onBoardAutoRunStopped(): void {
  runningBoardRefCount = Math.max(0, runningBoardRefCount - 1);
  applyPowerGuard();
}

/** Reconcile ref-count after reload when persisted boards were already running. */
export function syncAfkBoardPowerGuardFromSession(state: SessionState): void {
  let count = 0;
  for (const group of state.groups ?? []) {
    if (isBoardRunning(group)) count += 1;
  }
  runningBoardRefCount = count;
  applyPowerGuard();
}

/** Test helper — read current ref-count. */
export function getAfkBoardPowerGuardRefCountForTests(): number {
  return runningBoardRefCount;
}

/** Test helper — reset guard state. */
export function resetAfkBoardPowerGuardForTests(): void {
  runningBoardRefCount = 0;
  applyPowerGuard();
}
