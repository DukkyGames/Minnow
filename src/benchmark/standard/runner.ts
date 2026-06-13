/**
 * Run standard benchmark items against a model target.
 */

import { runOneShot } from '../llm-driver.ts';
import type { BenchmarkCellResult, BenchmarkTarget, BenchmarkTier } from '../campaign-types.ts';
import { buildCellId, targetKeyFromTarget, targetLabel } from '../model-key.ts';
import { buildTestResult } from '../test-result.ts';
import type { SuiteId } from '../types.ts';
import { getStandardPack, resolveStandardItems } from './pack-loader.ts';
import { scoreStandardItemHarness } from './harnesses/index.ts';
import type { StandardBenchmarkItem } from './types.ts';

/** Placeholder suite id — Academic cells use pack labels in the transcript drawer. */
const STANDARD_TRANSCRIPT_SUITE = 'capability' as SuiteId;

/** Prefer reasoning when length-truncated thinking models emit a stub letter in content. */
function responseTextForScoring(turn: {
  contentText: string;
  reasoningText: string;
  text: string;
  finishReason?: string;
}): string {
  const content = turn.contentText.trim();
  const reasoning = turn.reasoningText.trim();
  if (turn.finishReason === 'length' && reasoning.length > 0) {
    return reasoning.length > content.length ? reasoning : `${reasoning}\n${content}`;
  }
  return content || turn.text;
}

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
  tier: BenchmarkTier,
  item: StandardBenchmarkItem,
  signal: AbortSignal,
): Promise<BenchmarkCellResult> {
  const pack = getStandardPack(packId, tier);
  const targetKey = targetKeyFromTarget(target);
  const t0 = performance.now();
  let response = '';
  let ttftMs: number | undefined;
  let tokPerSec: number | undefined;
  let turn: Awaited<ReturnType<typeof runOneShot>> | null = null;

  try {
    turn = await runOneShot({
      providerId: target.providerId,
      modelId: target.modelId,
      messages: [{ role: 'user', content: item.prompt }],
      signal,
    });
    response = responseTextForScoring(turn);
    ttftMs = turn.timing.ttftMs ?? undefined;
    tokPerSec = turn.timing.tokPerSec ?? undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Math.round(performance.now() - t0);
    const scored = buildTestResult(
      {
        testId: item.id,
        suite: STANDARD_TRANSCRIPT_SUITE,
        label: item.id,
        passed: false,
        skipped: false,
        score: 0,
        durationMs,
        details: message,
      },
      null,
      { error: message },
    );
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
      durationMs,
      details: message,
      transcript: scored.transcript ?? [{ role: 'user', content: item.prompt }],
      transcriptMeta: scored.transcriptMeta,
    };
    return cell;
  }

  const scored = await scoreStandardItemHarness({
    kind: pack?.scoring ?? 'mcq',
    item,
    response,
    signal,
  });
  const durationMs = Math.round(performance.now() - t0);
  const withTranscript = buildTestResult(
    {
      testId: item.id,
      suite: STANDARD_TRANSCRIPT_SUITE,
      label: item.id,
      passed: scored.passed,
      skipped: false,
      score: scored.score,
      durationMs,
      ttftMs,
      tokPerSec,
      details: scored.details,
    },
    turn,
  );
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
    durationMs,
    ttftMs,
    tokPerSec,
    details: scored.details,
    transcript: withTranscript.transcript,
    transcriptMeta: withTranscript.transcriptMeta,
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
      options.tier,
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
