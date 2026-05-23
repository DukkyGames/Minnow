/**
 * Pure helpers for summing usage and averaging timing stats (MIN-36).
 */

import type { FinalizedResponseMeta, Stats, Usage } from '../../types';

/** Sub-agent row shape for aggregation (usage/stats only). */
export interface SubAgentStatsSlice {
  usage?: Usage;
  stats?: Stats;
}

/** Sum numeric usage fields across segments (missing treated as zero). */
export function sumUsageSegments(segments: Usage[]): Usage {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let hasPrompt = false;
  let hasCompletion = false;
  let hasTotal = false;

  for (const u of segments) {
    let segPrompt = 0;
    let segCompletion = 0;
    let segHasPrompt = false;
    let segHasCompletion = false;
    if (u.prompt_tokens != null && Number.isFinite(u.prompt_tokens)) {
      segPrompt = u.prompt_tokens;
      segHasPrompt = true;
      prompt += u.prompt_tokens;
      hasPrompt = true;
    }
    if (u.completion_tokens != null && Number.isFinite(u.completion_tokens)) {
      segCompletion = u.completion_tokens;
      segHasCompletion = true;
      completion += u.completion_tokens;
      hasCompletion = true;
    }
    if (u.total_tokens != null && Number.isFinite(u.total_tokens)) {
      total += u.total_tokens;
      hasTotal = true;
    } else if (segHasPrompt || segHasCompletion) {
      total += segPrompt + segCompletion;
      hasTotal = true;
    }
  }

  const out: Usage = {};
  if (hasPrompt) out.prompt_tokens = prompt;
  if (hasCompletion) out.completion_tokens = completion;
  if (hasTotal) {
    out.total_tokens = total;
  } else if (hasPrompt || hasCompletion) {
    out.total_tokens = prompt + completion;
  }
  return out;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedMeanTps(pairs: Array<{ tps: number; weight: number }>): number | undefined {
  let sum = 0;
  let weight = 0;
  for (const { tps, weight: w } of pairs) {
    if (w > 0) {
      sum += tps * w;
      weight += w;
    }
  }
  if (weight > 0) return sum / weight;
  return undefined;
}

type StatsUsagePair = { stats: Stats; usage: Usage };

/** Average timing stats; TPS weighted by completion tokens when available. */
export function averageStatsSegments(pairs: StatsUsagePair[]): Stats {
  const tpsWeighted: Array<{ tps: number; weight: number }> = [];
  const tpsSimple: number[] = [];
  const ttft: number[] = [];
  const gen: number[] = [];

  for (const { stats, usage } of pairs) {
    const tps = stats.tokens_per_second;
    if (tps != null && Number.isFinite(tps)) {
      const w = usage.completion_tokens;
      if (w != null && Number.isFinite(w) && w > 0) {
        tpsWeighted.push({ tps, weight: w });
      } else {
        tpsSimple.push(tps);
      }
    }
    if (stats.time_to_first_token != null && Number.isFinite(stats.time_to_first_token)) {
      ttft.push(stats.time_to_first_token);
    }
    if (stats.generation_time != null && Number.isFinite(stats.generation_time)) {
      gen.push(stats.generation_time);
    }
  }

  const out: Stats = {};
  const weightedTps = weightedMeanTps(tpsWeighted);
  const simpleTps = mean(tpsSimple);
  if (weightedTps != null) {
    out.tokens_per_second = weightedTps;
  } else if (simpleTps != null) {
    out.tokens_per_second = simpleTps;
  }
  const ttftMean = mean(ttft);
  if (ttftMean != null) out.time_to_first_token = ttftMean;
  const genMean = mean(gen);
  if (genMean != null) out.generation_time = genMean;
  return out;
}

/** Merge parent completion meta with sub-agent usage/stats slices. */
export function aggregateOrchestrateTurnMeta(
  parent: FinalizedResponseMeta,
  subRuns: SubAgentStatsSlice[],
): FinalizedResponseMeta {
  const segments: StatsUsagePair[] = [{ stats: parent.stats, usage: parent.usage }];
  for (const run of subRuns) {
    if (!run.usage && !run.stats) continue;
    segments.push({
      stats: run.stats ?? {},
      usage: run.usage ?? {},
    });
  }

  const usageParts = segments.map((s) => s.usage);
  const stats = averageStatsSegments(segments);
  if (parent.stats.stop_reason) {
    stats.stop_reason = parent.stats.stop_reason;
  }

  return {
    stats,
    usage: sumUsageSegments(usageParts),
    model_info: parent.model_info,
  };
}
