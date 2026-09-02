/**
 * Detect assistant prose that announced a next tool action but never called one.
 * Score the last sentence only so a mid-reply “Let me look…” does not retry
 * after the model already finished the work in the same bubble.
 */

const INTENT_PREFIX_RE =
  /^(?:(?:now|next)\s+)?(?:let me|i(?:['\u2019]ll| will| am going to|['\u2019]m going to))\b/i;
const WORK_VERB_RE =
  /\b(?:inspect(?:ing)?|read(?:ing)?|check(?:ing)?|set(?:ting)?\s+up|setup|writ(?:e|ing)|build(?:ing)?|verif(?:y|ying)|generat(?:e|ing)|wir(?:e|ing)|look(?:ing)?)\b/i;
const CLOSER_RE =
  /\blet me know\b|\bi(?:['\u2019]ll| will) wait\b|\btask complete\b|\bthat(?:['\u2019]s| is) (?:all|it)\b/i;
const WAIT_FOR_USER_RE =
  /\b(?:wait(?:ing)? for (?:your|the user)|check with you)\b|\bif you (?:want|need|would like)\b/i;

/**
 * Last sentence of the bubble. Split on `.!?…` so GET-9’s “Let me set up…”
 * is scored instead of the whole preamble.
 * @param {string} text
 * @returns {string}
 */
function lastSentence(text) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = trimmed
    .split(/(?:[.!?]|\u2026|\.{3})(?:\s+|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

/**
 * Last non-empty line — long answers often park “Let me know if you want tests.”
 * on its own line after a period-less body.
 * @param {string} text
 * @returns {string}
 */
function lastLine(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : text.trim();
}

/**
 * True when the closing sentence announces tool work (inspect, write, …)
 * rather than asking the user or closing the turn.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeIntentToAct(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return false;
  const sentence = lastSentence(trimmed);
  const closer = lastLine(trimmed);
  if (!sentence) return false;
  if (sentence.includes("?") || closer.includes("?")) return false;
  if (CLOSER_RE.test(sentence) || CLOSER_RE.test(closer)) return false;
  if (WAIT_FOR_USER_RE.test(sentence) || WAIT_FOR_USER_RE.test(closer)) return false;
  if (!INTENT_PREFIX_RE.test(sentence)) return false;
  return WORK_VERB_RE.test(sentence);
}

export { looksLikeIntentToAct };
