/**
 * Aggregate cell results into per-model leaderboard rows.
 */

import type { EvalCellResult, EvalModelTarget, LeaderboardRow } from './types';
import { buildModelKey } from './model-key';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

/** Build leaderboard rows from completed cells and suite targets. */
export function computeLeaderboard(
  cells: EvalCellResult[],
  targets: EvalModelTarget[],
): LeaderboardRow[] {
  const rows: LeaderboardRow[] = [];

  for (const target of targets) {
    const modelKey = buildModelKey(target.providerId, target.modelId);
    const label =
      target.label?.trim() ||
      `${target.providerId} / ${target.modelId}`.trim();
    const modelCells = cells.filter(
      (c) =>
        c.modelKey === modelKey &&
        c.status === 'completed' &&
        c.grader != null,
    );

    const scores = modelCells.map((c) => c.grader!.score);
    const passCount = modelCells.filter((c) => c.grader!.pass).length;
    const durations = modelCells.map((c) => c.durationMs);
    const failedCells = cells.filter(
      (c) => c.modelKey === modelKey && c.status !== 'completed',
    ).length;
    const completedCells = modelCells.length;

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    for (const cell of modelCells) {
      totalPromptTokens += cell.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += cell.usage?.completion_tokens ?? 0;
    }

    const meanScore =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
    const passRate =
      completedCells > 0 ? passCount / completedCells : 0;

    rows.push({
      modelKey,
      label,
      providerId: target.providerId,
      modelId: target.modelId,
      meanScore: Math.round(meanScore * 10) / 10,
      passRate: Math.round(passRate * 1000) / 1000,
      medianDurationMs: median(durations),
      totalPromptTokens,
      totalCompletionTokens,
      failedCells,
      completedCells,
    });
  }

  return rows.sort((a, b) => b.meanScore - a.meanScore);
}
