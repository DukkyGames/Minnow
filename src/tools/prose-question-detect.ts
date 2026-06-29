/**
 * Detect assistant prose that should have used the `ask_question` tool instead.
 * Heuristics are conservative to avoid retrying normal numbered instructions.
 */

/** Phrases that signal the model is asking the user to pick among options. */
const CHOICE_PHRASE_RE =
  /\b(which (one|option)|please (choose|pick|select)|would you (like|prefer)|pick one|select one|choose one|let me know (which|what)|your preference)\b/i;

/** Decision-style questions that introduce a numbered choice list (not open follow-ups). */
const CHOICE_QUESTION_RE =
  /\bwhich\b[^?\n]{0,80}\b(first|next|option|path|scope|area|approach|priority)\b/i;

/** Numbered lines that look like preset choices (1. foo / 2) bar). */
const NUMBERED_OPTION_LINE_RE = /^\s*\d+[.)]\s+\S/gm;

/** Dash bullets — only count when a choice phrase is present (descriptive lists are common). */
const DASH_OPTION_LINE_RE = /^\s*[-*•]\s+\S/gm;

/** Inline lettered options such as "A) foo  B) bar". */
const LETTER_PAREN_OPTION_RE = /\b[A-D]\)\s+\S/g;

/** Markdown-bold option headers such as "**MVP:** ship smallest slice". */
const BOLD_OPTION_LINE_RE = /^\s*\*\*[^*]{2,48}\*\*\s*[:—–-]\s*\S/gm;

/** End offset of the last structured option line (numbered or bold header). */
function structuredOptionsEndOffset(text: string): number {
  let end = -1;
  for (const re of [NUMBERED_OPTION_LINE_RE, BOLD_OPTION_LINE_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const lineStart = match.index;
      const lineBreak = text.indexOf('\n', lineStart);
      end = Math.max(end, lineBreak === -1 ? text.length : lineBreak);
    }
  }
  return end;
}

/**
 * True when plain-language assistant text likely presents multiple-choice options
 * that belong in the `ask_question` card UI.
 */
export function looksLikeProseStructuredQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 48) return false;

  const hasQuestionMark = trimmed.includes('?');
  const hasChoicePhrase = CHOICE_PHRASE_RE.test(trimmed);
  const hasChoiceQuestion = CHOICE_QUESTION_RE.test(trimmed);
  if (!hasQuestionMark && !hasChoicePhrase) return false;

  const numberedOptionCount = (trimmed.match(NUMBERED_OPTION_LINE_RE) ?? []).length;
  const letterParenCount = (trimmed.match(LETTER_PAREN_OPTION_RE) ?? []).length;
  const boldOptionCount = (trimmed.match(BOLD_OPTION_LINE_RE) ?? []).length;
  const dashOptionCount = hasChoicePhrase
    ? (trimmed.match(DASH_OPTION_LINE_RE) ?? []).length
    : 0;

  const structuredOptionSignals =
    numberedOptionCount + letterParenCount + boldOptionCount;
  const optionSignals = structuredOptionSignals + dashOptionCount;
  if (optionSignals < 2) return false;

  // "What is this?" plus descriptive dash bullets is not a multiple-choice card.
  if (hasQuestionMark && !hasChoicePhrase && structuredOptionSignals < 2) {
    return false;
  }

  // Repo tours and how-to lists often end with an open follow-up after numbered sections.
  if (
    hasQuestionMark &&
    !hasChoicePhrase &&
    !hasChoiceQuestion &&
    structuredOptionSignals >= 2
  ) {
    const optionsEnd = structuredOptionsEndOffset(trimmed);
    const lastQuestionIdx = trimmed.lastIndexOf('?');
    if (optionsEnd >= 0 && lastQuestionIdx > optionsEnd) {
      return false;
    }
  }

  return true;
}
