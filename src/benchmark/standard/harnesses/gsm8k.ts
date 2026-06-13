/**
 * GSM8K numeric harness — official #### answer extraction with fallback.
 */

import type { StandardBenchmarkItem } from '../types.ts';
import type { StandardScoreResult } from './types.ts';

const GSM8K_HASH_RE = /####\s*(-?[\d,]+(?:\.\d+)?)/;
const NUMBER_RE = /-?[\d,]+(?:\.\d+)?/g;

/** Strip commas and normalize integer trailing .0 for comparison. */
export function normalizeGsm8kNumber(raw: string): string {
  const stripped = raw.replace(/,/g, '').trim();
  if (!stripped) return '';
  if (/^-?\d+\.0+$/.test(stripped)) {
    return stripped.replace(/\.0+$/, '');
  }
  return stripped;
}

/** Extract the model's numeric answer — #### first, then last number in the response. */
export function extractGsm8kAnswer(response: string): string {
  const hashMatch = response.match(GSM8K_HASH_RE);
  if (hashMatch?.[1]) {
    return normalizeGsm8kNumber(hashMatch[1]);
  }

  const nums = response.match(NUMBER_RE);
  if (!nums || nums.length === 0) return '';
  return normalizeGsm8kNumber(nums[nums.length - 1]!);
}

export function scoreGsm8k(item: StandardBenchmarkItem, response: string): StandardScoreResult {
  const expected = normalizeGsm8kNumber(item.groundTruth);
  const actual = extractGsm8kAnswer(response);
  const passed = actual === expected;

  const usedHash = GSM8K_HASH_RE.test(response);
  const extractionNote = usedHash ? '####' : 'last-number fallback';

  return {
    passed,
    score: passed ? 1 : 0,
    details: passed
      ? undefined
      : `Expected ${expected}, got ${actual || '(empty)'} (${extractionNote})`,
  };
}
