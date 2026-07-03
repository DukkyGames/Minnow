/**
 * Detect assistant prose that should have used the `ask_question` tool instead.
 * Heuristics are conservative to avoid retrying normal numbered instructions.
 */

/** Phrases that signal the model is asking the user to pick among options. */
const CHOICE_PHRASE_RE =
  /\b((?:what|which) would you like|which (one|option)|please (choose|pick|select)|would you (like|prefer)|pick one|select one|choose one|let me know (which|what)|your preference)\b/i;

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

/** "I can:" lead-in before plain-language action options (mode handoffs, next steps). */
const I_CAN_COLON_RE = /\bI can:\s*(?:\n|$)/i;

/** "Would you like to:" lead-in before a plain-language option block. */
const WOULD_YOU_LIKE_TO_COLON_RE = /\bWould you like to:\s*(?:\n|$)/i;

/**
 * Plain-language menu lines after a choice phrase — not numbered lists.
 * Covers imperative starters, optional bullets, em-dash rows, and question options.
 */
const PROSE_MENU_OPTION_LINE_RE =
  /^\s*(?:[-*•]\s+)?(?:Or\b|Switch to\b|Refine(?:\s+the)?\b|Create (?:a |an )?\b|Open (?:a |an )?\b).+|^\s*(?:[-*•]\s+)?[A-Z][^\n]{4,100}\s+[—–-]\s+.+/gm;

/** Index of the first regex match, or -1 when absent. */
function firstMatchOffset(text: string, re: RegExp): number {
  re.lastIndex = 0;
  const match = re.exec(text);
  return match ? match.index : -1;
}

/** Index of the last global regex match, or -1 when absent. */
function lastMatchOffset(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = global.exec(text)) !== null) {
    last = match.index;
  }
  return last;
}

/** Index of the first numbered, bold-header, or dash bullet option line. */
function firstStructuredOptionOffset(text: string, includeDashBullets: boolean): number {
  const offsets = [
    firstMatchOffset(text, NUMBERED_OPTION_LINE_RE),
    firstMatchOffset(text, BOLD_OPTION_LINE_RE),
    includeDashBullets ? firstMatchOffset(text, DASH_OPTION_LINE_RE) : -1,
  ].filter((offset) => offset >= 0);
  return offsets.length > 0 ? Math.min(...offsets) : -1;
}

/** Index of the earliest choice-directing phrase or decision-style question. */
function firstChoiceDirectiveOffset(text: string): number {
  const offsets = [
    firstMatchOffset(text, CHOICE_PHRASE_RE),
    firstMatchOffset(text, CHOICE_QUESTION_RE),
  ].filter((offset) => offset >= 0);
  return offsets.length > 0 ? Math.min(...offsets) : -1;
}

/** Start of the final option block (after the last explicit menu lead-in). */
function proseMenuTailStart(text: string): number {
  const candidates = [
    lastMatchOffset(text, WOULD_YOU_LIKE_TO_COLON_RE),
    lastMatchOffset(text, /\bWhat would you like to do next\?\s*/gi),
    lastMatchOffset(text, I_CAN_COLON_RE),
    firstChoiceDirectiveOffset(text),
  ].filter((offset) => offset >= 0);
  return candidates.length > 0 ? Math.max(...candidates) : -1;
}

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

/** Count plain menu option lines that trail the final choice lead-in. */
function countProseMenuOptions(text: string): number {
  const startOffset = proseMenuTailStart(text);
  if (startOffset < 0) {
    return 0;
  }
  const tail = text.slice(startOffset);
  PROSE_MENU_OPTION_LINE_RE.lastIndex = 0;
  return (tail.match(PROSE_MENU_OPTION_LINE_RE) ?? []).length;
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
  const hasICanLeadIn = I_CAN_COLON_RE.test(trimmed);
  const hasWouldYouLikeToLeadIn = WOULD_YOU_LIKE_TO_COLON_RE.test(trimmed);
  if (
    !hasQuestionMark &&
    !hasChoicePhrase &&
    !hasICanLeadIn &&
    !hasWouldYouLikeToLeadIn
  ) {
    return false;
  }

  const proseMenuOptionCount = countProseMenuOptions(trimmed);
  if (
    proseMenuOptionCount >= 2 &&
    (hasChoicePhrase ||
      hasChoiceQuestion ||
      hasICanLeadIn ||
      hasWouldYouLikeToLeadIn)
  ) {
    return true;
  }

  const numberedOptionCount = (trimmed.match(NUMBERED_OPTION_LINE_RE) ?? []).length;
  const letterParenCount = (trimmed.match(LETTER_PAREN_OPTION_RE) ?? []).length;
  const boldOptionCount = (trimmed.match(BOLD_OPTION_LINE_RE) ?? []).length;
  const dashOptionCount = hasChoicePhrase
    ? (trimmed.match(DASH_OPTION_LINE_RE) ?? []).length
    : 0;

  // Inline lettered options are always a multiple-choice card candidate.
  if (letterParenCount >= 2 && (hasQuestionMark || hasChoicePhrase)) {
    return true;
  }

  const structuredOptionSignals =
    numberedOptionCount + letterParenCount + boldOptionCount;
  const optionSignals = structuredOptionSignals + dashOptionCount;
  if (optionSignals < 2) return false;

  // "What is this?" plus descriptive dash bullets is not a multiple-choice card.
  if (hasQuestionMark && !hasChoicePhrase && structuredOptionSignals < 2) {
    return false;
  }

  const firstOptionOffset = firstStructuredOptionOffset(trimmed, hasChoicePhrase);
  const choiceDirectiveOffset = firstChoiceDirectiveOffset(trimmed);

  // Numbered/bold lists are informational unless a choice directive precedes them.
  if (firstOptionOffset >= 0) {
    if (choiceDirectiveOffset < 0 || choiceDirectiveOffset > firstOptionOffset) {
      return false;
    }
  }

  // Repo tours and info dumps often end with open follow-ups after numbered sections.
  if (structuredOptionSignals >= 2) {
    const optionsEnd = structuredOptionsEndOffset(trimmed);
    const lastQuestionIdx = trimmed.lastIndexOf('?');
    if (optionsEnd >= 0 && lastQuestionIdx > optionsEnd) {
      return false;
    }
  }

  // Require an explicit choice signal when only dash bullets qualify as options.
  if (structuredOptionSignals < 2 && dashOptionCount >= 2) {
    return hasChoicePhrase || hasChoiceQuestion;
  }

  return true;
}
