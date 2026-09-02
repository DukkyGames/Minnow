/** Caps for one real agent attempt. */

/**
 * Wall-clock ceiling per attempt, in milliseconds.
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
  if (typeof overrides.maxTurns === 'number' && overrides.maxTurns > 0) {
    limits.maxTurns = overrides.maxTurns;
  }
  return limits;
}
