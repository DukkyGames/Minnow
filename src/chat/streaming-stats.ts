/**
 * Live token metrics during SSE streaming (MIN-413).
 * Estimates completion tokens from partial output when the provider omits usage mid-stream.
 */

import {
  buildClientStats,
  reconcileCompletionStats,
  type StreamMetaAccumulator,
} from '../api/chat';
import { resolveModelInfo } from '../api/models';
import {
  aggregateTurnUsageSegments,
  averageStatsSegments,
} from '../chat/plans/stats-math';
import { estimateTokensFromText } from './prompts/token-estimate-core';
import { getActiveChat } from '../state/sessions';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import type { Chat, ModelInfo, Stats, Usage } from '../types';

/** Throttle DOM refresh so fast models do not repaint the strip every chunk. */
export const LIVE_STREAM_STATS_THROTTLE_MS = 100;

export interface StreamingStatsSnapshot {
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  partialText: string;
  /**
   * Streamed reasoning size in characters. Length only — callers must not join
   * thought-bubble segments (O(thinking) per token). Unused for token estimates
   * (provider usage reports reasoning); kept so the strip snapshot stays cheap.
   */
  partialThinkingLength?: number;
  /** Completed usage from earlier tool-loop rounds in the same user turn. */
  priorSegments?: Usage[];
  /** Completed stats + usage from earlier tool-loop rounds (weighted live tok/s). */
  priorStatsSegments?: Array<{ stats: Stats; usage: Usage }>;
  modelId?: string;
  modelInfo?: ModelInfo;
}

function hasLiveCompletionUsage(usage: Usage | undefined): boolean {
  if (!usage) return false;
  return (
    usage.completion_tokens != null &&
    Number.isFinite(usage.completion_tokens) &&
    usage.completion_tokens > 0
  );
}

/** Usage for the in-flight API round only (no prior tool-loop rollup). */
export function buildCurrentRoundUsage(
  input: StreamingStatsSnapshot,
  _now = performance.now(),
): Usage {
  const { streamMeta, partialText } = input;
  const roundEstimate = estimateTokensFromText(partialText);
  const live = streamMeta.usage;

  if (hasLiveCompletionUsage(live)) {
    return { ...live! };
  }

  const out: Usage = {};
  if (live?.prompt_tokens != null && Number.isFinite(live.prompt_tokens)) {
    out.prompt_tokens = live.prompt_tokens;
  }
  if (roundEstimate > 0) {
    out.completion_tokens = roundEstimate;
  }
  if (out.prompt_tokens != null || out.completion_tokens != null) {
    out.total_tokens = (out.prompt_tokens ?? 0) + (out.completion_tokens ?? 0);
  }
  return out;
}

/** Usage for an in-progress stream: provider chunk usage when present, else char estimate. */
export function buildLiveStreamUsage(
  input: StreamingStatsSnapshot,
  _now = performance.now(),
): Usage {
  const { streamMeta, partialText, priorSegments } = input;
  const priorSegmentsList = priorSegments ?? [];
  const priorAgg = priorSegmentsList.length
    ? aggregateTurnUsageSegments(priorSegmentsList)
    : {};

  // Estimate visible assistant prose only; reasoning tokens arrive via provider usage.
  const roundEstimate = estimateTokensFromText(partialText);

  const live = streamMeta.usage;
  if (hasLiveCompletionUsage(live)) {
    if (!priorSegmentsList.length) return { ...live! };
    return aggregateTurnUsageSegments([...priorSegmentsList, live!]);
  }

  const completion = (priorAgg.completion_tokens ?? 0) + roundEstimate;
  const prompt = live?.prompt_tokens ?? priorAgg.prompt_tokens;

  const out: Usage = {};
  if (prompt != null && Number.isFinite(prompt)) out.prompt_tokens = prompt;
  if (roundEstimate > 0 || priorAgg.completion_tokens != null) {
    out.completion_tokens = completion;
  }
  if (out.prompt_tokens != null || out.completion_tokens != null) {
    out.total_tokens = (out.prompt_tokens ?? 0) + (out.completion_tokens ?? 0);
  }
  return out;
}

/** Timing stats (TTFT, generation time, tok/s) for a stream still in flight. */
export function buildLiveStreamStats(
  input: StreamingStatsSnapshot,
  now = performance.now(),
): Stats {
  const { streamMeta, t0, tFirst, priorStatsSegments } = input;
  const roundUsage = buildCurrentRoundUsage(input, now);
  const clientStats = buildClientStats(t0, tFirst, now, roundUsage, undefined);
  const serverStats = streamMeta.stats ?? {};
  const roundStats = reconcileCompletionStats(clientStats, serverStats, roundUsage);

  const priorList = priorStatsSegments ?? [];
  if (!priorList.length) return roundStats;

  return averageStatsSegments([...priorList, { stats: roundStats, usage: roundUsage }]);
}

/** Combined live stats + usage for the metrics strip. */
export function buildLiveStreamMeta(
  input: StreamingStatsSnapshot,
  now = performance.now(),
): { stats: Stats; usage: Usage } {
  const usage = buildLiveStreamUsage(input, now);
  const stats = buildLiveStreamStats(input, now);
  return { stats, usage };
}

export interface StreamingStatsPublisher {
  schedule: (input: StreamingStatsSnapshot) => void;
  flush: (input: StreamingStatsSnapshot) => void;
  reset: () => void;
}

/** Throttled updater for chat.lastStats and the bottom metrics strip. */
export function createStreamingStatsPublisher(chat: Chat): StreamingStatsPublisher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: StreamingStatsSnapshot | null = null;

  function apply(input: StreamingStatsSnapshot): void {
    const meta = buildLiveStreamMeta(input);
    chat.lastStats = buildLastStatsSnapshot(meta.stats, meta.usage);

    if (getActiveChat().id !== chat.id) return;

    const modelId = input.modelId ?? chat.modelId ?? '';
    const modelInfo = resolveModelInfo(modelId, input.modelInfo ?? chat.modelInfo ?? {});
    updateStrip(meta.stats, meta.usage, modelInfo);
  }

  function schedule(input: StreamingStatsSnapshot): void {
    pending = input;
    if (timer != null) return;
    timer = setTimeout(() => {
      timer = null;
      if (pending) apply(pending);
    }, LIVE_STREAM_STATS_THROTTLE_MS);
  }

  function flush(input: StreamingStatsSnapshot): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
    apply(input);
  }

  function reset(): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  return { schedule, flush, reset };
}
