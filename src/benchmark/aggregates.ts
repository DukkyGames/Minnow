/**
 * Aggregate per-model scores from campaign cells and integration runs.
 */

import type {
  BenchmarkCampaign,
  BenchmarkCellResult,
  BenchmarkTarget,
  ModelAggregate,
  ModelScoreIndexRow,
} from './campaign-types.ts';
import { buildTargetKey, targetKeyFromTarget, targetLabel } from './model-key.ts';
import type { BenchmarkRun } from './types.ts';

function meanScores(scores: number[]): number {
  const valid = scores.filter((n) => Number.isFinite(n));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function familyMean(cells: BenchmarkCellResult[], family: BenchmarkCellResult['family']): number {
  const subset = cells.filter((c) => c.family === family && !c.skipped);
  if (!subset.length) return 0;
  return meanScores(subset.map((c) => c.score));
}

/** Build a model aggregate from integration run + optional extra cells. */
export function aggregateFromRun(
  target: BenchmarkTarget,
  run: BenchmarkRun,
  cells: BenchmarkCellResult[] = [],
): ModelAggregate {
  const targetKey = targetKeyFromTarget(target);
  const targetCells = cells.filter((c) => c.targetKey === targetKey);
  return {
    targetKey,
    providerId: target.providerId,
    modelId: target.modelId,
    label: targetLabel(target),
    totalScore: run.totalScore,
    headlineTokPerSec: run.headlineTokPerSec,
    headlineTtftMs: run.headlineTtftMs,
    integrationScore: run.totalScore,
    standardScore: familyMean(targetCells, 'standard'),
    customScore: familyMean(targetCells, 'custom'),
    runId: run.id,
  };
}

/** Merge aggregates across cells when no integration run exists. */
export function aggregateFromCells(
  target: BenchmarkTarget,
  cells: BenchmarkCellResult[],
): ModelAggregate {
  const targetKey = targetKeyFromTarget(target);
  const targetCells = cells.filter((c) => c.targetKey === targetKey && !c.skipped);
  const scores = targetCells.map((c) => c.score);
  const tps = targetCells
    .map((c) => c.tokPerSec)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const ttft = targetCells
    .map((c) => c.ttftMs)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return {
    targetKey,
    providerId: target.providerId,
    modelId: target.modelId,
    label: targetLabel(target),
    totalScore: meanScores(scores),
    headlineTokPerSec: median(tps),
    headlineTtftMs: median(ttft),
    integrationScore: familyMean(targetCells, 'integration'),
    standardScore: familyMean(targetCells, 'standard'),
    customScore: familyMean(targetCells, 'custom'),
  };
}

/** Compute campaign-level aggregates for every target. */
export function computeCampaignAggregates(
  campaign: Pick<BenchmarkCampaign, 'targets' | 'cells' | 'runs'>,
): ModelAggregate[] {
  return campaign.targets.map((target) => {
    const key = targetKeyFromTarget(target);
    const run = campaign.runs.find(
      (r) => (r.targetKey?.trim() || buildTargetKey(r.provider.id, r.model.id)) === key,
    );
    if (run) return aggregateFromRun(target, run, campaign.cells);
    return aggregateFromCells(target, campaign.cells);
  });
}

/** Latest score per model for Overview index. */
export function buildModelScoreIndex(
  campaigns: BenchmarkCampaign[],
): ModelScoreIndexRow[] {
  const byKey = new Map<string, ModelScoreIndexRow>();
  const sorted = [...campaigns].sort((a, b) =>
    String(b.startedAt).localeCompare(String(a.startedAt)),
  );
  for (const campaign of sorted) {
    const aggregates =
      campaign.aggregates?.length > 0
        ? campaign.aggregates
        : computeCampaignAggregates(campaign);
    for (const agg of aggregates) {
      if (byKey.has(agg.targetKey)) continue;
      byKey.set(agg.targetKey, {
        targetKey: agg.targetKey,
        providerId: agg.providerId,
        modelId: agg.modelId,
        label: agg.label,
        campaignId: campaign.id,
        startedAt: campaign.startedAt,
        totalScore: agg.totalScore,
        headlineTokPerSec: agg.headlineTokPerSec,
        headlineTtftMs: agg.headlineTtftMs,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.totalScore - a.totalScore);
}

/** Pick fastest and highest-quality models for completion insight. */
export function pickCampaignInsight(aggregates: ModelAggregate[]): {
  fastest: ModelAggregate | null;
  quality: ModelAggregate | null;
} {
  if (!aggregates.length) return { fastest: null, quality: null };
  const withTps = aggregates.filter((a) => a.headlineTokPerSec > 0);
  const fastest =
    withTps.length > 0
      ? [...withTps].sort((a, b) => b.headlineTokPerSec - a.headlineTokPerSec)[0]!
      : null;
  const quality = [...aggregates].sort((a, b) => b.totalScore - a.totalScore)[0]!;
  return { fastest, quality };
}
