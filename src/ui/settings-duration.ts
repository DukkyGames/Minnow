/** Show persisted millisecond durations as whole seconds in settings inputs. */
export function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

/** Convert settings UI seconds back to persisted milliseconds. */
export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}
