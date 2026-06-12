/**
 * Run standard benchmark items against a model target.
 */

import { runOneShot } from '../llm-driver.ts';
import type { BenchmarkCellResult, BenchmarkTarget, BenchmarkTier } from '../campaign-types.ts';
import { buildCellId, targetKeyFromTarget, targetLabel } from '../model-key.ts';
import { getStandardPack, resolveStandardItems } from './pack-loader.ts';
import { scoreStandardItem } from './scorers.ts';
import type { StandardBenchmarkItem } from './types.ts';

export interface RunStandardPackOptions {
  target: BenchmarkTarget;
  packId: string;
  tier: BenchmarkTier;
  signal: AbortSignal;
  onItemDone?: (cell: BenchmarkCellResult) => void;
}

async function runOneStandardItem(
  target: BenchmarkTarget,
  packId: string,
  item: StandardBenchmarkItem,
  signal: AbortSignal,
): Promise<BenchmarkCellResult> {
  const pack = getStandardPack(packId);
  const targetKey = targetKeyFromTarget(target);
  const t0 = performance.now();
  let response = '';
  let ttftMs: number | undefined;
  let tokPerSec: number | undefined;

  try {
    const turn = await runOneShot({
      providerId: target.providerId,
      modelId: target.modelId,
      messages: [{ role: 'user', content: item.prompt }],
      signal,
      maxTokens: 256,
    });
    response = turn.text;
    ttftMs = turn.timing.ttftMs ?? undefined;
    tokPerSec = turn.timing.tokPerSec ?? undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cell: BenchmarkCellResult = {
      cellId: buildCellId(targetKey, item.id),
      targetKey,
      family: 'standard',
      suiteId: packId,
      testId: item.id,
      label: item.id,
      passed: false,
      skipped: false,
      score: 0,
      durationMs: Math.round(performance.now() - t0),
      details: message,
    };
    return cell;
  }

  const scored = scoreStandardItem(pack?.scoring ?? 'mcq', item, response);
  const cell: BenchmarkCellResult = {
    cellId: buildCellId(targetKey, item.id),
    targetKey,
    family: 'standard',
    suiteId: packId,
    testId: item.id,
    label: item.id,
    passed: scored.passed,
    skipped: false,
    score: scored.score,
    durationMs: Math.round(performance.now() - t0),
    ttftMs,
    tokPerSec,
    details: scored.details,
  };
  return cell;
}

/** Run all items in a standard pack for one target (serial). */
export async function runStandardPackForTarget(
  options: RunStandardPackOptions,
): Promise<BenchmarkCellResult[]> {
  const items = resolveStandardItems(options.packId, options.tier);
  const results: BenchmarkCellResult[] = [];
  for (const item of items) {
    if (options.signal.aborted) break;
    const cell = await runOneStandardItem(
      options.target,
      options.packId,
      item,
      options.signal,
    );
    results.push(cell);
    options.onItemDone?.(cell);
  }
  return results;
}

export function targetDisplayLabel(target: BenchmarkTarget): string {
  return targetLabel(target);
}
