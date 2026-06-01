/**
 * Detect assistant prose that should have used the `ask_question` tool instead.
 * Heuristics are conservative to avoid retrying normal numbered instructions.
 */

/** Phrases that signal the model is asking the user to pick among options. */
const CHOICE_PHRASE_RE =
  /\b(which (one|option)|please (choose|pick|select)|would you (like|prefer)|pick one|select one|choose one|let me know (which|what)|your preference)\b/i;

/** Numbered lines that look like preset choices (1. foo / 2) bar). */
const NUMBERED_OPTION_LINE_RE = /^\s*\d+[.)]\s+\S/gm;

/** Dash bullets — only count when a choice phrase is present (descriptive lists are common). */
const DASH_OPTION_LINE_RE = /^\s*[-*•]\s+\S/gm;

/** Inline lettered options such as "A) foo  B) bar". */
const LETTER_PAREN_OPTION_RE = /\b[A-D]\)\s+\S/g;

/** Markdown-bold option headers such as "**MVP:** ship smallest slice". */
const BOLD_OPTION_LINE_RE = /^\s*\*\*[^*]{2,48}\*\*\s*[:—–-]\s*\S/gm;

/**
 * True when plain-language assistant text likely presents multiple-choice options
 * that belong in the `ask_question` card UI.
 */
export function looksLikeProseStructuredQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 48) return false;

  const hasQuestionMark = trimmed.includes('?');
  const hasChoicePhrase = CHOICE_PHRASE_RE.test(trimmed);
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

  return true;
}
