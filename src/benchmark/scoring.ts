/**
 * Pure scoring helpers for benchmark test cases.
 */

export function exactMatch(actual: string, expected: string): boolean {
  return actual.trim() === expected.trim();
}

export function regexMatch(actual: string, pattern: RegExp): boolean {
  return pattern.test(actual);
}

export function jsonShapeMatch(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function toolNameMatch(
  toolCalls: Array<{ function: { name: string } }>,
  expectedName: string,
): boolean {
  return toolCalls.some((tc) => tc.function.name === expectedName);
}

export interface JudgeVerdict {
  pass: boolean;
  reason: string;
}

/** Parse LLM judge JSON from model output. */
export function parseJudgeJson(text: string): JudgeVerdict {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { pass: false, reason: 'No JSON object in judge response' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { pass?: boolean; reason?: string };
    return {
      pass: parsed.pass === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return { pass: false, reason: 'Invalid judge JSON' };
  }
}

/** Weighted mean of per-test scores (0..1), excluding skipped. */
export function aggregateSuiteScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((a, b) => a + b, 0);
  return sum / scores.length;
}

export interface SuiteStatsTest {
  passed: boolean;
  skipped: boolean;
}

/** Suite pass/fail counts and pass-rate score (0..1); skipped tests are excluded from score. */
export function computeSuiteResultStats(tests: SuiteStatsTest[]): {
  passed: number;
  failed: number;
  skipped: number;
  score: number;
} {
  const skipped = tests.filter((t) => t.skipped).length;
  const active = tests.filter((t) => !t.skipped);
  const passed = active.filter((t) => t.passed).length;
  const failed = active.length - passed;
  const score = active.length ? passed / active.length : 0;
  return { passed, failed, skipped, score };
}

/** Overall run score from suite scores weighted by non-skipped test counts. */
export function aggregateRunScore(suites: { score: number; tests: { skipped: boolean }[] }[]): number {
  let weighted = 0;
  let weight = 0;
  for (const suite of suites) {
    const active = suite.tests.filter((t) => !t.skipped).length;
    if (active === 0) continue;
    weighted += suite.score * active;
    weight += active;
  }
  if (weight === 0) return 0;
  return weighted / weight;
}
