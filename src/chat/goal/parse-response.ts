/**
 * Parse strict YES/NO + reason evaluator output for the /goal loop.
 */

export interface ParsedGoalEvalResponse {
  met: boolean;
  reason: string;
}

/** Strip leading verdict token and optional punctuation from evaluator text. */
function extractReasonAfterVerdict(raw: string, verdictLen: number, fallback: string): string {
  const tail = raw.slice(verdictLen).replace(/^[\s:.\-–—]+/, '').trim();
  return tail || fallback;
}

/**
 * Parse evaluator completion. Malformed output is treated as not met so the loop
 * can continue with guidance rather than falsely clearing the goal.
 */
export function parseGoalEvalResponse(raw: string): ParsedGoalEvalResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { met: false, reason: 'Evaluator returned an empty response.' };
  }

  const yesMatch = /^YES\b/i.exec(trimmed);
  if (yesMatch) {
    return {
      met: true,
      reason: extractReasonAfterVerdict(
        trimmed,
        yesMatch[0].length,
        'Goal condition satisfied.',
      ),
    };
  }

  const noMatch = /^NO\b/i.exec(trimmed);
  if (noMatch) {
    return {
      met: false,
      reason: extractReasonAfterVerdict(
        trimmed,
        noMatch[0].length,
        'Goal not yet complete.',
      ),
    };
  }

  return {
    met: false,
    reason: `Evaluator returned malformed response (expected YES or NO): ${trimmed.slice(0, 240)}`,
  };
}
