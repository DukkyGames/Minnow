/**
 * Derived board execution mode.
 *
 * Boards no longer persist a four-value `executionMode`. The user-facing controls
 * are **how many at once** ({@link OrchestrateBoardState.maxConcurrentTasks}) and
 * **may it interrupt me** ({@link OrchestrateBoardState.handsOff}); the legacy mode
 * string is derived from those two so the ~60 downstream reads (tool filter,
 * permission gate, prompt contract, log invariants) keep working unchanged.
 *
 * Pure — no session/UI imports — so the permission gate and tool filter can read it
 * without pulling in the board store.
 */

import { getAutopilotMetaSync } from '../config/autopilot-meta.ts';
import type { OrchestrateBoardState } from '../types.ts';

/** Legacy mode vocabulary. `manual` is no longer producible (kept for hydration). */
export type BoardExecutionMode = 'manual' | 'auto' | 'sequential' | 'afk';

/** Hard fallback when neither the board nor global settings specify concurrency. */
export const DEFAULT_MAX_CONCURRENT = 3;

/** Board concurrency before OOM throttling: board ?? global ?? fallback, clamped to [1,20]. */
export function resolveBoardConcurrency(
  board: OrchestrateBoardState | null | undefined,
): number {
  const boardVal = board?.maxConcurrentTasks;
  const raw =
    typeof boardVal === 'number' && Number.isFinite(boardVal) && boardVal > 0
      ? boardVal
      : (getAutopilotMetaSync().maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT);
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

/** True when the board runs fully hands-off (never prompts the user). */
export function isBoardHandsOff(
  board: OrchestrateBoardState | null | undefined,
): boolean {
  return board?.handsOff === true;
}

/**
 * Single derivation point for the legacy mode string:
 * hands-off → `afk`; concurrency 1 → `sequential`; otherwise → `auto`.
 */
export function deriveBoardExecutionMode(
  board: OrchestrateBoardState | null | undefined,
): BoardExecutionMode {
  if (!board) return 'sequential';
  if (isBoardHandsOff(board)) return 'afk';
  return resolveBoardConcurrency(board) === 1 ? 'sequential' : 'auto';
}

export { applyLegacyExecutionMode } from '../lib/legacy-execution-mode.mjs';
