/**
 * Parse grader JSON from LLM output with safe fallback.
 */

import type { EvalGraderResult } from './types';

const FALLBACK: EvalGraderResult = {
  score: 0,
  pass: false,
  rationale: 'Grader returned malformed JSON',
};

/** Extract first JSON object from model text and map to grader result. */
export function parseGraderJson(raw: string): EvalGraderResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ...FALLBACK, rawResponse: raw };
  }

  let candidate = trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    candidate = fence[1].trim();
  } else {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      candidate = trimmed.slice(start, end + 1);
    }
  }

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const scoreRaw = parsed.score;
    const score =
      typeof scoreRaw === 'number' && Number.isFinite(scoreRaw)
        ? Math.max(0, Math.min(100, scoreRaw))
        : 0;
    const pass = parsed.pass === true;
    const rationale =
      typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : 'No rationale provided';
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === 'string')
      : undefined;
    return { score, pass, rationale, tags, rawResponse: raw };
  } catch {
    return { ...FALLBACK, rawResponse: raw };
  }
}
