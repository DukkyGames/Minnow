/**
 * In-memory editor AI completion metrics (local diagnostics only).
 */

export type EditorAiCompletionRejectReason =
  | 'empty'
  | 'empty_after_trim'
  | 'prefix_echo'
  | 'prose'
  | 'oversized'
  | 'full_rewrite'
  | 'unbalanced'
  | (string & {});

export type EditorAiCompletionEvent =
  | { type: 'request' }
  | { type: 'cache_hit' }
  | { type: 'shown' }
  | { type: 'accepted' }
  | { type: 'dismissed' }
  | { type: 'reject'; reason: EditorAiCompletionRejectReason }
  | { type: 'timing'; firstTokenMs: number; totalMs: number };

export type EditorAiMetricsSnapshot = {
  requests: number;
  cacheHits: number;
  shown: number;
  accepted: number;
  acceptRate: number | null;
  rejectByReason: Record<string, number>;
  firstTokenMs: { p50: number | null; p95: number | null };
  totalMs: { p50: number | null; p95: number | null };
};

let requests = 0;
let cacheHits = 0;
let shown = 0;
let accepted = 0;
const rejectByReason = new Map<string, number>();
const firstTokenSamples: number[] = [];
const totalMsSamples: number[] = [];

const MAX_TIMING_SAMPLES = 200;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? null;
}

function pushTimingSample(bucket: number[], value: number): void {
  bucket.push(value);
  if (bucket.length > MAX_TIMING_SAMPLES) bucket.shift();
}

/** Record one editor AI completion lifecycle event. */
export function recordCompletionEvent(event: EditorAiCompletionEvent): void {
  switch (event.type) {
    case 'request':
      requests += 1;
      break;
    case 'cache_hit':
      cacheHits += 1;
      break;
    case 'shown':
      shown += 1;
      break;
    case 'accepted':
      accepted += 1;
      break;
    case 'dismissed':
      break;
    case 'reject': {
      const key = event.reason || 'unknown';
      rejectByReason.set(key, (rejectByReason.get(key) ?? 0) + 1);
      break;
    }
    case 'timing':
      pushTimingSample(firstTokenSamples, event.firstTokenMs);
      pushTimingSample(totalMsSamples, event.totalMs);
      break;
    default:
      break;
  }
}

/** Latest aggregate metrics for Settings / debug probes. */
export function getEditorAiMetrics(): EditorAiMetricsSnapshot {
  const firstSorted = [...firstTokenSamples].sort((a, b) => a - b);
  const totalSorted = [...totalMsSamples].sort((a, b) => a - b);
  const rejectRecord: Record<string, number> = {};
  for (const [reason, count] of rejectByReason) rejectRecord[reason] = count;
  const acceptRate = shown > 0 ? accepted / shown : null;
  return {
    requests,
    cacheHits,
    shown,
    accepted,
    acceptRate,
    rejectByReason: rejectRecord,
    firstTokenMs: {
      p50: percentile(firstSorted, 0.5),
      p95: percentile(firstSorted, 0.95),
    },
    totalMs: {
      p50: percentile(totalSorted, 0.5),
      p95: percentile(totalSorted, 0.95),
    },
  };
}

/** Reset counters (tests only). */
export function resetEditorAiMetricsForTests(): void {
  requests = 0;
  cacheHits = 0;
  shown = 0;
  accepted = 0;
  rejectByReason.clear();
  firstTokenSamples.length = 0;
  totalMsSamples.length = 0;
}

/** Same gate as {@link logBootMetricsIfDebug}. */
export function isEditorAiMetricsDebugEnabled(): boolean {
  const env = import.meta.env;
  return (
    env?.DEV === true || env?.MINNOW_DEBUG === '1' || env?.MINNOW_DEBUG === 'true'
  );
}
