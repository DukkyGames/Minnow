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

function stripMarkdownDecorations(line: string): string {
  return line
    .replace(/^\s*[#>*]+\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function normalizeVerdictCandidate(line: string): string {
  let normalized = stripMarkdownDecorations(line);
  normalized = normalized.replace(/^[([{]+/, '').replace(/[)\]}]+$/, '').trim();
  normalized = normalized.replace(
    /^(?:verdict|answer|result|decision|conclusion|final(?:\s+answer)?)\s*:\s*/i,
    '',
  );
  return normalized.trim();
}

function parseVerdictLine(
  line: string,
  met: boolean,
  fallback: string,
): ParsedGoalEvalResponse | null {
  const normalized = normalizeVerdictCandidate(line);
  const pattern = met ? /^YES\b/i : /^NO\b/i;
  const match = pattern.exec(normalized);
  if (!match) return null;
  return {
    met,
    reason: extractReasonAfterVerdict(normalized, match[0].length, fallback),
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

function tryParseJsonVerdict(trimmed: string): ParsedGoalEvalResponse | null {
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const reason =
      typeof parsed.reason === 'string'
        ? parsed.reason.trim()
        : typeof parsed.explanation === 'string'
          ? parsed.explanation.trim()
          : '';

    if (typeof parsed.met === 'boolean') {
      return {
        met: parsed.met,
        reason: reason || (parsed.met ? 'Goal condition satisfied.' : 'Goal not yet complete.'),
      };
    }
    if (typeof parsed.achieved === 'boolean') {
      return {
        met: parsed.achieved,
        reason:
          reason || (parsed.achieved ? 'Goal condition satisfied.' : 'Goal not yet complete.'),
      };
    }
    if (typeof parsed.passed === 'boolean') {
      return {
        met: parsed.passed,
        reason: reason || (parsed.passed ? 'Goal condition satisfied.' : 'Goal not yet complete.'),
      };
    }

    const verdictRaw = parsed.verdict ?? parsed.answer ?? parsed.result;
    if (typeof verdictRaw === 'string') {
      const verdict = verdictRaw.trim().toUpperCase();
      if (verdict === 'YES' || verdict.startsWith('YES ')) {
        return { met: true, reason: reason || 'Goal condition satisfied.' };
      }
      if (verdict === 'NO' || verdict.startsWith('NO ')) {
        return { met: false, reason: reason || 'Goal not yet complete.' };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function parseEmbeddedVerdict(trimmed: string): ParsedGoalEvalResponse | null {
  const match = /\b(?:verdict|answer|result|decision)\s*:\s*(YES|NO)\b/i.exec(trimmed);
  if (!match) return null;
  const met = match[1].toUpperCase() === 'YES';
  const tail = trimmed.slice(match.index + match[0].length).replace(/^[\s:.\-–—]+/, '').trim();
  return {
    met,
    reason: tail || (met ? 'Goal condition satisfied.' : 'Goal not yet complete.'),
  };
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

  const jsonVerdict = tryParseJsonVerdict(trimmed);
  if (jsonVerdict) return jsonVerdict;

  const leadingYes = parseVerdictLine(trimmed, true, 'Goal condition satisfied.');
  if (leadingYes) return leadingYes;

  const leadingNo = parseVerdictLine(trimmed, false, 'Goal not yet complete.');
  if (leadingNo) return leadingNo;

  const embedded = parseEmbeddedVerdict(trimmed);
  if (embedded) return embedded;

  const trailing = parseVerdictFromTrailingLines(trimmed);
  if (trailing) return trailing;

  return {
    met: false,
    reason: `Evaluator returned malformed response (expected YES or NO): ${trimmed.slice(0, 240)}`,
  };
}
