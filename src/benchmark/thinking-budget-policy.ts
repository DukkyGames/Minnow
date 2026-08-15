/**
 * Wall-clock-aware thinking budget for benchmark probes.
 *
 * Chat's flat 8192-token budget is throughput-blind. At the ~16 tok/s a local 27B streams,
 * 8192 reasoning tokens need ~512s of contiguous thinking, so a 300s probe timeout always
 * fires first: the watchdog can never trip, the probe is killed with no output, and the row
 * scores `fail` with an empty transcript. Size the budget from the time the probe actually
 * has instead, using the rate the run has observed for that target.
 */

/** Share of a probe's wall clock that may go to reasoning before the watchdog trips. */
export const BENCHMARK_THINKING_TIME_SHARE = 0.4;

/**
 * Stream rate assumed before this run has measured one. Deliberately low — guessing fast
 * on a slow host reproduces the bug this module exists to fix, while guessing slow only
 * costs a little reasoning headroom on the first probe.
 */
export const BENCHMARK_FALLBACK_TOK_PER_SEC = 16;

/** Floor: below this a reasoning model cannot finish even a short deliberation. */
export const MIN_BENCHMARK_THINKING_TOKENS = 384;

/** Ceiling: chat's flat budget, used when no timeout bounds the call. */
export const MAX_BENCHMARK_THINKING_TOKENS = 8192;

export interface ResolveBenchmarkThinkingBudgetInput {
  /** Probe wall-clock budget; omitted for suites that run without a timeout. */
  timeoutMs?: number;
  /** Observed stream rate for this target, when the run has one. */
  tokPerSec?: number | null;
}

/**
 * Tokens of reasoning a probe may spend before the watchdog makes it commit.
 * Without a timeout there is nothing to derive from, so fall back to chat's budget.
 */
export function resolveBenchmarkThinkingBudgetTokens(
  input: ResolveBenchmarkThinkingBudgetInput,
): number {
  const timeoutMs = input.timeoutMs;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return MAX_BENCHMARK_THINKING_TOKENS;
  }

  const rate =
    input.tokPerSec != null && Number.isFinite(input.tokPerSec) && input.tokPerSec > 0
      ? input.tokPerSec
      : BENCHMARK_FALLBACK_TOK_PER_SEC;

  const allowance = (timeoutMs / 1000) * rate * BENCHMARK_THINKING_TIME_SHARE;
  return Math.min(
    MAX_BENCHMARK_THINKING_TOKENS,
    Math.max(MIN_BENCHMARK_THINKING_TOKENS, Math.round(allowance)),
  );
}

/** Smoothing on observed rates so one slow prompt-processing turn does not dominate. */
const THROUGHPUT_SMOOTHING = 0.5;

const observedTokPerSec = new Map<string, number>();

function throughputKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

/** Record a completed turn's stream rate for later budget sizing. */
export function recordBenchmarkThroughput(
  providerId: string,
  modelId: string,
  tokPerSec: number | null | undefined,
): void {
  if (tokPerSec == null || !Number.isFinite(tokPerSec) || tokPerSec <= 0) return;
  const key = throughputKey(providerId, modelId);
  const prior = observedTokPerSec.get(key);
  observedTokPerSec.set(
    key,
    prior == null ? tokPerSec : prior * (1 - THROUGHPUT_SMOOTHING) + tokPerSec * THROUGHPUT_SMOOTHING,
  );
}

/** Observed stream rate for a target, or null before the run has measured one. */
export function getBenchmarkThroughput(providerId: string, modelId: string): number | null {
  return observedTokPerSec.get(throughputKey(providerId, modelId)) ?? null;
}

/** Clear observed rates (tests, and between campaigns). */
export function resetBenchmarkThroughput(): void {
  observedTokPerSec.clear();
}
