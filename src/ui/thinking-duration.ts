/**
 * Accumulated reasoning-active wall time (SSE deltas only), not TTFT.
 * Segments pause between endReasoningPhase and the next reasoning delta (tool loops).
 */

const TICK_MS = 100;

/**
 * Human-readable duration for Thoughts toggle and stream-status suffix.
 */
export function formatThinkingDuration(ms: number): string {
  if (ms <= 0) return '0.0s';
  if (ms > 0 && ms < 100) return '0.1s';
  const seconds = ms / 1000;
  if (ms >= 1000) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${seconds.toFixed(2)}s`;
}

/**
 * Sums closed reasoning intervals; optional live tick while a segment is open.
 */
export class ThinkingDurationTracker {
  private closedMs = 0;

  private segmentStart: number | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private lastTickFormatted = '';

  private readonly onTick: ((elapsedMs: number) => void) | undefined;

  constructor(onTick?: (elapsedMs: number) => void) {
    this.onTick = onTick;
  }

  /** Begin a reasoning-active interval (ignored if one is already open). */
  startSegment(): void {
    if (this.segmentStart != null) return;
    this.segmentStart = performance.now();
    this.ensureTick();
    this.emitTickIfChanged();
  }

  /** Close the current reasoning interval and add it to the running total. */
  endSegment(): void {
    if (this.segmentStart == null) return;
    this.closedMs += performance.now() - this.segmentStart;
    this.segmentStart = null;
    this.stopTick();
    this.emitTickIfChanged();
  }

  /** End any open segment, stop timers, return total accumulated ms. */
  finalize(): number {
    this.endSegment();
    this.stopTick();
    return this.getElapsedMs();
  }

  /** Total ms across closed segments plus any open segment. */
  getElapsedMs(): number {
    let total = this.closedMs;
    if (this.segmentStart != null) {
      total += performance.now() - this.segmentStart;
    }
    return Math.max(0, Math.round(total));
  }

  /** Clear state on abort without persisting partial duration. */
  abort(): void {
    this.closedMs = 0;
    this.segmentStart = null;
    this.stopTick();
    this.lastTickFormatted = '';
  }

  private ensureTick(): void {
    if (this.tickTimer != null) return;
    this.tickTimer = setInterval(() => this.emitTickIfChanged(), TICK_MS);
  }

  private stopTick(): void {
    if (this.tickTimer == null) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.lastTickFormatted = '';
  }

  private emitTickIfChanged(): void {
    if (!this.onTick) return;
    const formatted = formatThinkingDuration(this.getElapsedMs());
    if (formatted === this.lastTickFormatted) return;
    this.lastTickFormatted = formatted;
    this.onTick(this.getElapsedMs());
  }
}
