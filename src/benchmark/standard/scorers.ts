/**
 * Deterministic scorers for standard LLM benchmark items.
 * Prefer scoreStandardItemHarness from ./harnesses/index.ts for runner integration.
 */

import { scoreStandardItemHarness } from './harnesses/index.ts';
import { scoreGsm8k } from './harnesses/gsm8k.ts';
import { scoreMcq } from './harnesses/mcq.ts';
import { scoreRegex } from './harnesses/regex.ts';
import type { StandardBenchmarkItem, StandardScoringKind } from './types.ts';

export type { StandardScoreResult } from './harnesses/types.ts';
export { scoreStandardItemHarness } from './harnesses/index.ts';
export { scoreGsm8k, scoreMcq, scoreRegex } from './harnesses/index.ts';

/** @deprecated Use scoreGsm8k — kept for tests importing scoreNumeric */
export const scoreNumeric = scoreGsm8k;

/** Extract fenced code from model response (JavaScript or Python). */
export function extractCodeBlock(text: string): string {
  const fence = text.match(/```(?:javascript|js|python|py)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1]!.trim();
  return text.trim();
}

/** Synchronous scoring — HumanEval returns a stub fail; use scoreStandardItemHarness in runner. */
export function scoreStandardItem(
  kind: StandardScoringKind,
  item: StandardBenchmarkItem,
  response: string,
): import('./harnesses/types.ts').StandardScoreResult {
  if (kind === 'mcq') return scoreMcq(item, response);
  if (kind === 'numeric') return scoreGsm8k(item, response);
  if (kind === 'regex') return scoreRegex(item, response);
  if (kind === 'code') {
    return {
      passed: false,
      score: 0,
      details: 'Code scoring requires scoreStandardItemHarness (async HumanEval harness)',
    };
  }
  return { passed: false, score: 0, details: 'Judge scoring handled separately' };
}

/** Async wrapper for callers that need harness routing without passing signal. */
export async function scoreStandardItemAsync(
  kind: StandardScoringKind,
  item: StandardBenchmarkItem,
  response: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<import('./harnesses/types.ts').StandardScoreResult> {
  return scoreStandardItemHarness({ kind, item, response, signal });
}
