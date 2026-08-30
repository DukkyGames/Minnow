const CHOICE_PHRASE_RE = /\b((?:what|which) would you like|which (one|option)|please (choose|pick|select)|would you (like|prefer)|pick one|select one|choose one|let me know (which|what)|your preference)\b/i;
const CHOICE_QUESTION_RE = /\bwhich\b[^?\n]{0,80}\b(first|next|option|path|scope|area|approach|priority)\b/i;
const NUMBERED_OPTION_LINE_RE = /^\s*\d+[.)]\s+\S/gm;
const DASH_OPTION_LINE_RE = /^\s*[-*•]\s+\S/gm;
const LETTER_PAREN_OPTION_RE = /\b[A-D]\)\s+\S/g;
const BOLD_OPTION_LINE_RE = /^\s*\*\*[^*]{2,48}\*\*\s*[:—–-]\s*\S/gm;
const I_CAN_COLON_RE = /\bI can:\s*(?:\n|$)/i;
const WOULD_YOU_LIKE_TO_COLON_RE = /\bWould you like to:\s*(?:\n|$)/i;
const PROSE_MENU_OPTION_LINE_RE = /^\s*(?:[-*•]\s+)?(?:Or\b|Switch to\b|Refine(?:\s+the)?\b|Create (?:a |an )?\b|Open (?:a |an )?\b).+|^\s*(?:[-*•]\s+)?[A-Z][^\n]{4,100}\s+[—–-]\s+.+/gm;
function firstMatchOffset(text, re) {
  re.lastIndex = 0;
  const match = re.exec(text);
  return match ? match.index : -1;
}
function lastMatchOffset(text, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let last = -1;
  let match;
  while ((match = global.exec(text)) !== null) {
    last = match.index;
  }
  return last;
}
function firstStructuredOptionOffset(text, includeDashBullets) {
  const offsets = [
    firstMatchOffset(text, NUMBERED_OPTION_LINE_RE),
    firstMatchOffset(text, BOLD_OPTION_LINE_RE),
    includeDashBullets ? firstMatchOffset(text, DASH_OPTION_LINE_RE) : -1
  ].filter((offset) => offset >= 0);
  return offsets.length > 0 ? Math.min(...offsets) : -1;
}
function firstChoiceDirectiveOffset(text) {
  const offsets = [
    firstMatchOffset(text, CHOICE_PHRASE_RE),
    firstMatchOffset(text, CHOICE_QUESTION_RE)
  ].filter((offset) => offset >= 0);
  return offsets.length > 0 ? Math.min(...offsets) : -1;
}
function proseMenuTailStart(text) {
  const candidates = [
    lastMatchOffset(text, WOULD_YOU_LIKE_TO_COLON_RE),
    lastMatchOffset(text, /\bWhat would you like to do next\?\s*/gi),
    lastMatchOffset(text, I_CAN_COLON_RE),
    firstChoiceDirectiveOffset(text)
  ].filter((offset) => offset >= 0);
  return candidates.length > 0 ? Math.max(...candidates) : -1;
}
function structuredOptionsEndOffset(text) {
  let end = -1;
  for (const re of [NUMBERED_OPTION_LINE_RE, BOLD_OPTION_LINE_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const lineStart = match.index;
      const lineBreak = text.indexOf("\n", lineStart);
      end = Math.max(end, lineBreak === -1 ? text.length : lineBreak);
    }
  }
  return end;
}
function countProseMenuOptions(text) {
  const startOffset = proseMenuTailStart(text);
  if (startOffset < 0) {
    return 0;
  }
  const tail = text.slice(startOffset);
  PROSE_MENU_OPTION_LINE_RE.lastIndex = 0;
  return (tail.match(PROSE_MENU_OPTION_LINE_RE) ?? []).length;
}
function looksLikeProseStructuredQuestion(text) {
  const trimmed = text.trim();
  if (trimmed.length < 48) return false;
  const hasQuestionMark = trimmed.includes("?");
  const hasChoicePhrase = CHOICE_PHRASE_RE.test(trimmed);
  const hasChoiceQuestion = CHOICE_QUESTION_RE.test(trimmed);
  const hasICanLeadIn = I_CAN_COLON_RE.test(trimmed);
  const hasWouldYouLikeToLeadIn = WOULD_YOU_LIKE_TO_COLON_RE.test(trimmed);
  if (!hasQuestionMark && !hasChoicePhrase && !hasICanLeadIn && !hasWouldYouLikeToLeadIn) {
    return false;
  }
  const proseMenuOptionCount = countProseMenuOptions(trimmed);
  if (proseMenuOptionCount >= 2 && (hasChoicePhrase || hasChoiceQuestion || hasICanLeadIn || hasWouldYouLikeToLeadIn)) {
    return true;
  }
  const numberedOptionCount = (trimmed.match(NUMBERED_OPTION_LINE_RE) ?? []).length;
  const letterParenCount = (trimmed.match(LETTER_PAREN_OPTION_RE) ?? []).length;
  const boldOptionCount = (trimmed.match(BOLD_OPTION_LINE_RE) ?? []).length;
  const dashOptionCount = hasChoicePhrase ? (trimmed.match(DASH_OPTION_LINE_RE) ?? []).length : 0;
  if (letterParenCount >= 2 && (hasQuestionMark || hasChoicePhrase)) {
    return true;
  }
  const structuredOptionSignals = numberedOptionCount + letterParenCount + boldOptionCount;
  const optionSignals = structuredOptionSignals + dashOptionCount;
  if (optionSignals < 2) return false;
  if (hasQuestionMark && !hasChoicePhrase && structuredOptionSignals < 2) {
    return false;
  }
  const firstOptionOffset = firstStructuredOptionOffset(trimmed, hasChoicePhrase);
  const choiceDirectiveOffset = firstChoiceDirectiveOffset(trimmed);
  if (firstOptionOffset >= 0) {
    if (choiceDirectiveOffset < 0 || choiceDirectiveOffset > firstOptionOffset) {
      return false;
    }
  }
  if (structuredOptionSignals >= 2) {
    const optionsEnd = structuredOptionsEndOffset(trimmed);
    const lastQuestionIdx = trimmed.lastIndexOf("?");
    if (optionsEnd >= 0 && lastQuestionIdx > optionsEnd) {
      return false;
    }
  }
  if (structuredOptionSignals < 2 && dashOptionCount >= 2) {
    return hasChoicePhrase || hasChoiceQuestion;
  }
  return true;
}
export {
  looksLikeProseStructuredQuestion
};
