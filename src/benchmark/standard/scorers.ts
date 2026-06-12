/**
 * Deterministic scorers for standard LLM benchmark items.
 */

import type { StandardBenchmarkItem, StandardScoringKind } from './types.ts';

export interface StandardScoreResult {
  passed: boolean;
  score: number;
  details?: string;
}

function normalizeLetter(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/\b([A-D])\b/i);
  return match ? match[1]!.toUpperCase() : trimmed.toUpperCase().slice(0, 1);
}

export function scoreMcq(item: StandardBenchmarkItem, response: string): StandardScoreResult {
  const expected = normalizeLetter(item.groundTruth);
  const actual = normalizeLetter(response);
  const passed = actual === expected;
  return {
    passed,
    score: passed ? 1 : 0,
    details: passed ? undefined : `Expected ${expected}, got ${actual || '(empty)'}`,
  };
}

export function scoreNumeric(item: StandardBenchmarkItem, response: string): StandardScoreResult {
  const nums = response.match(/-?\d+(?:\.\d+)?/g);
  const actual = nums ? nums[nums.length - 1] : '';
  const passed = actual === item.groundTruth.trim();
  return {
    passed,
    score: passed ? 1 : 0,
    details: passed ? undefined : `Expected ${item.groundTruth}, got ${actual || '(empty)'}`,
  };
}

export function scoreRegex(item: StandardBenchmarkItem, response: string): StandardScoreResult {
  try {
    let pattern = item.groundTruth;
    let flags = '';
    if (pattern.startsWith('(?i)')) {
      pattern = pattern.slice(4);
      flags = 'i';
    }
    const re = new RegExp(pattern, flags);
    const passed = re.test(response);
    return {
      passed,
      score: passed ? 1 : 0,
      details: passed ? undefined : 'Response did not match expected pattern',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, score: 0, details: `Invalid regex: ${message}` };
  }
}

/** Extract fenced JavaScript from model response. */
export function extractJavascriptBlock(text: string): string {
  const fence = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1]!.trim();
  return text.trim();
}

export function scoreStandardItem(
  kind: StandardScoringKind,
  item: StandardBenchmarkItem,
  response: string,
): StandardScoreResult {
  if (kind === 'mcq') return scoreMcq(item, response);
  if (kind === 'numeric') return scoreNumeric(item, response);
  if (kind === 'regex') return scoreRegex(item, response);
  if (kind === 'code') {
    const code = extractJavascriptBlock(response);
    const passed = code.length > 8 && /function\s+\w+/.test(code);
    return {
      passed,
      score: passed ? 1 : 0,
      details: passed ? undefined : 'No valid function in response',
    };
  }
  return { passed: false, score: 0, details: 'Judge scoring handled separately' };
}
