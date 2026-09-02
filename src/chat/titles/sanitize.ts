import { AUTO_TITLE_MAX_LEN } from '../../constants';

/** Model outputs that signal reasoning instead of a real title (start-anchored). */
const THINKING_TITLE_PATTERNS = [
  /^here'?s (a )?(thinking|my thinking)/i,
  /^let me (think|analyze|analyse|consider|break|walk|work)/i,
  /^i(?:'ll| will) (think|analyze|analyse|consider|break)/i,
  /^i need to (think|analyze|analyse|consider|understand)/i,
  /^thinking (about|through|carefully)/i,
  /^my (thinking|analysis|reasoning)\b/i,
  /^analyzing (the|this|your|what)/i,
  /^analysing (the|this|your|what)/i,
  /^to (answer|address|respond to) (this|your|the)/i,
  /^the user (is asking|asked|wants|needs|seems)/i,
  /^(okay|ok),?\s+(so|let me|first)/i,
  /^first,?\s+(i|let me|the user)/i,
  /^step \d+[:.)]/i,
  /^reasoning:/i,
  /^thought:/i,
  /^analysis:/i,
  /^break(?:ing)? (this|it|down)/i,
  /^working through/i,
  /^looking at (this|your|the|what)/i,
  /^hmm+,?\s/i,
];

/** High-confidence reasoning phrases anywhere in the candidate title. */
const THINKING_TITLE_SUBSTRINGS = [
  /thinking process/i,
  /chain[- ]?of[- ]?thought/i,
  /<\s*\/?think\s*>/i,
  /redacted_thinking/i,
];

function isThinkingBoilerplateTitle(text: string): boolean {
  if (THINKING_TITLE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return THINKING_TITLE_SUBSTRINGS.some((pattern) => pattern.test(text));
}

/** Strip fences, quotes, and excess length from a model title string. */
export function normalizeTitle(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  text = text.replace(/```+/g, '').trim();

  text = text.replace(/^title:\s*/i, '').trim();

  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  text = text.replace(/\.$/, '').trim();

  if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;

  if (/^untitled$/i.test(text)) return null;
  if (isThinkingBoilerplateTitle(text)) return null;

  if (text.length > AUTO_TITLE_MAX_LEN) {
    return `${text.slice(0, AUTO_TITLE_MAX_LEN)}…`;
  }
  return text;
}

/** Deterministic sidebar title from the first user message when LLM title fails. */
export function fallbackTitleFromSeed(seed: string): string | null {
  let text = seed.trim().replace(/\s+/g, ' ');
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;

  if (text.length > AUTO_TITLE_MAX_LEN) {
    return `${text.slice(0, AUTO_TITLE_MAX_LEN)}…`;
  }
  return text;
}
