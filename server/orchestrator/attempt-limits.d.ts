/** Wall-clock ceiling per attempt, in milliseconds. */
export const ATTEMPT_WALL_CLOCK_MS: number;

/** Merge overrides onto the production defaults. No default `maxTurns`. */
export function attemptLimits(overrides?: {
  maxTurns?: number;
  wallClockMs?: number;
}): { maxTurns?: number; wallClockMs: number };
