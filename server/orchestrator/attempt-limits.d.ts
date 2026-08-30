/** Wall-clock ceiling per attempt, in milliseconds. */
export const ATTEMPT_WALL_CLOCK_MS: number;

/** Maximum completion requests per attempt, including inner-loop finalization. */
export const ATTEMPT_MAX_TURNS: number;

/** Merge overrides onto the production defaults. */
export function attemptLimits(overrides?: {
  maxTurns?: number;
  wallClockMs?: number;
}): { maxTurns: number; wallClockMs: number };
