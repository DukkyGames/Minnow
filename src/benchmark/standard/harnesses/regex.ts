/**
 * Regex pattern harness (TruthfulQA mini lightweight proxy).
 */

import type { StandardBenchmarkItem } from '../types.ts';
import type { StandardScoreResult } from './types.ts';

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
