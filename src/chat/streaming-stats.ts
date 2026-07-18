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
import { sumUsageSegments } from './orchestrate/stats-math';
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
  partialThinking?: string;
  /** Completed usage from earlier tool-loop rounds in the same user turn. */
  priorSegments?: Usage[];
  modelId?: string;
  modelInfo?: ModelInfo;
}

function hasMeasurableUsage(usage: Usage | undefined): boolean {
  if (!usage) return false;
  return (
    (usage.prompt_tokens != null && Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens > 0) ||
    (usage.completion_tokens != null &&
      Number.isFinite(usage.completion_tokens) &&
      usage.completion_tokens > 0) ||
    (usage.total_tokens != null && Number.isFinite(usage.total_tokens) && usage.total_tokens > 0)
  );
}

/** Usage for an in-progress stream: provider chunk usage when present, else char estimate. */
export function buildLiveStreamUsage(
  input: StreamingStatsSnapshot,
  _now = performance.now(),
): Usage {
  const { streamMeta, partialText, partialThinking, priorSegments } = input;
  const prior = priorSegments?.length ? sumUsageSegments(priorSegments) : {};

  const roundEstimate =
    estimateTokensFromText(partialText) + estimateTokensFromText(partialThinking ?? '');

  if (hasMeasurableUsage(streamMeta.usage)) {
    const live = { ...streamMeta.usage! };
    if (!priorSegments?.length) return live;
    return sumUsageSegments([prior, live]);
  }

  const completion = (prior.completion_tokens ?? 0) + roundEstimate;
  const prompt = streamMeta.usage?.prompt_tokens ?? prior.prompt_tokens;

  const out: Usage = {};
  if (prompt != null && Number.isFinite(prompt)) out.prompt_tokens = prompt;
  if (roundEstimate > 0 || prior.completion_tokens != null) {
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
  usage: Usage,
  now = performance.now(),
): Stats {
  const { streamMeta, t0, tFirst } = input;
  const clientStats = buildClientStats(t0, tFirst, now, usage, undefined);
  const serverStats = streamMeta.stats ?? {};
  return reconcileCompletionStats(clientStats, serverStats, usage);
}

/** Combined live stats + usage for the metrics strip. */
export function buildLiveStreamMeta(
  input: StreamingStatsSnapshot,
  now = performance.now(),
): { stats: Stats; usage: Usage } {
  const usage = buildLiveStreamUsage(input, now);
  const stats = buildLiveStreamStats(input, usage, now);
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
