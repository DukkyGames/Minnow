/**
 * Caps for one real agent attempt (P2-F).
 *
 * These live in one module so a timeout is a named policy, not a magic number
 * copied into the effector and the tests. Hitting either cap is `timeout` —
 * the runner produces that outcome; the engine does not infer it.
 *
 * Not a stall detector. The reconcile loop does not watch these clocks.
 * `runTurn` enforces them and returns `timeout`, which the policy table
 * already knows how to route.
 */

/**
 * Wall-clock ceiling per attempt, in milliseconds.
 *
 * 30 minutes: long enough for a tool-heavy build-and-test loop on a local
 * model, short enough that a hung upstream cannot occupy a slot overnight.
 * Tests override this (1 second) rather than waiting on the production value.
 */
export const ATTEMPT_WALL_CLOCK_MS = 30 * 60 * 1000;

/**
 * Maximum completion requests per attempt, including inner-loop finalization.
 *
 * 32 turns is generous for a Builder that reads, edits, and re-checks; past
 * that the agent is looping, not working. `runTurn` counts provider calls,
 * so this is a real cap rather than a tool-call cap.
 */
export const ATTEMPT_MAX_TURNS = 32;

/**
 * @param {{ maxTurns?: number, wallClockMs?: number }} [overrides]
 * @returns {{ maxTurns: number, wallClockMs: number }}
 */
export function attemptLimits(overrides = {}) {
  return {
    maxTurns:
      typeof overrides.maxTurns === 'number' && overrides.maxTurns > 0
        ? overrides.maxTurns
        : ATTEMPT_MAX_TURNS,
    wallClockMs:
      typeof overrides.wallClockMs === 'number' && overrides.wallClockMs > 0
        ? overrides.wallClockMs
        : ATTEMPT_WALL_CLOCK_MS,
  };
}
