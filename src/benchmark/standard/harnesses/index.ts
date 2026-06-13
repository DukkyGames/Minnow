/**
 * Router for per-dataset standard benchmark harnesses.
 */

import type { StandardBenchmarkItem, StandardScoringKind } from '../types.ts';
import { scoreGsm8k } from './gsm8k.ts';
import { scoreHumanEval } from './humaneval.ts';
import { scoreMcq } from './mcq.ts';
import { scoreRegex } from './regex.ts';
import type { StandardScoreResult } from './types.ts';

export type { StandardScoreResult } from './types.ts';
export { extractGsm8kAnswer, normalizeGsm8kNumber, scoreGsm8k } from './gsm8k.ts';
export { assembleHumanEvalProgram, derivePromptPrefix, HUMANEVAL_PROMPT_SUFFIX, normalizeBodyIndent, scoreHumanEval } from './humaneval.ts';
export { scoreMcq } from './mcq.ts';
export { scoreRegex } from './regex.ts';

export interface ScoreStandardItemHarnessOptions {
  kind: StandardScoringKind;
  item: StandardBenchmarkItem;
  response: string;
  signal: AbortSignal;
}

/** Score one standard item using the official per-dataset harness (async for HumanEval). */
export async function scoreStandardItemHarness(
  options: ScoreStandardItemHarnessOptions,
): Promise<StandardScoreResult> {
  const { kind, item, response, signal } = options;

  if (kind === 'mcq') return scoreMcq(item, response);
  if (kind === 'numeric') return scoreGsm8k(item, response);
  if (kind === 'regex') return scoreRegex(item, response);
  if (kind === 'code') return scoreHumanEval({ item, response, signal });
  return { passed: false, score: 0, details: 'Judge scoring handled separately' };
}
