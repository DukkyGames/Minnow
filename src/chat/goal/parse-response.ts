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

function parseVerdictLine(
  line: string,
  met: boolean,
  fallback: string,
): ParsedGoalEvalResponse | null {
  const pattern = met ? /^YES\b/i : /^NO\b/i;
  const match = pattern.exec(line.trim());
  if (!match) return null;
  return {
    met,
    reason: extractReasonAfterVerdict(line.trim(), match[0].length, fallback),
  };
}

/** Scan trailing non-empty lines — thinking models often put the verdict on the last line. */
function parseVerdictFromTrailingLines(trimmed: string): ParsedGoalEvalResponse | null {
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const yes = parseVerdictLine(lines[i], true, 'Goal condition satisfied.');
    if (yes) return yes;
    const no = parseVerdictLine(lines[i], false, 'Goal not yet complete.');
    if (no) return no;
  }
  return null;
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

  const leadingYes = parseVerdictLine(trimmed, true, 'Goal condition satisfied.');
  if (leadingYes) return leadingYes;

  const leadingNo = parseVerdictLine(trimmed, false, 'Goal not yet complete.');
  if (leadingNo) return leadingNo;

  const trailing = parseVerdictFromTrailingLines(trimmed);
  if (trailing) return trailing;

  return {
    met: false,
    reason: `Evaluator returned malformed response (expected YES or NO): ${trimmed.slice(0, 240)}`,
  };
}
