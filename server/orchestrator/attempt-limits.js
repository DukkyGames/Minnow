/**
 * Caps for one real agent attempt (P2-F).
 *
 * These live in one module so a timeout is a named policy, not a magic number
 * copied into the effector and the tests. Hitting the wall-clock cap is
 * `timeout` — the runner produces that outcome; the engine does not infer it.
 *
 * There is no default turn cap. Tool-heavy builders routinely exceed a few
 * dozen completion requests; killing them for that was false timeouts.
 * Callers (tests) may still pass `maxTurns` as an override.
 *
 * Not a stall detector. The reconcile loop does not watch this clock.
 * `runTurn` enforces `wallClockMs` and returns `timeout`, which the policy
 * table already knows how to route.
 */

/**
 * Wall-clock ceiling per attempt, in milliseconds.
 *
 * 120 minutes: long enough for a slow local model on a large task, short
 * enough that a hung upstream cannot occupy a slot overnight.
 * Tests override this (1 second) rather than waiting on the production value.
 */
export const ATTEMPT_WALL_CLOCK_MS = 120 * 60 * 1000;

/**
 * @param {{ maxTurns?: number, wallClockMs?: number }} [overrides]
 * @returns {{ maxTurns?: number, wallClockMs: number }}
 */
export function attemptLimits(overrides = {}) {
  /** @type {{ maxTurns?: number, wallClockMs: number }} */
  const limits = {
    wallClockMs:
      typeof overrides.wallClockMs === 'number' && overrides.wallClockMs > 0
        ? overrides.wallClockMs
        : ATTEMPT_WALL_CLOCK_MS,
  };
  // Only apply a turn cap when the caller asked for one (tests). Production
  // board and sub-agent attempts run until the wall clock or a real outcome.
  if (typeof overrides.maxTurns === 'number' && overrides.maxTurns > 0) {
    limits.maxTurns = overrides.maxTurns;
  }
  return limits;
}
