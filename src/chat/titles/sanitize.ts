/**
 * Normalize raw model output into a sidebar-safe chat title.
 */

import { AUTO_TITLE_MAX_LEN } from '../../constants';

/** Model outputs that signal reasoning instead of a real title. */
const THINKING_TITLE_PATTERNS = [
  /^here'?s (a )?thinking/i,
  /^let me (think|analyze)/i,
];

function isThinkingBoilerplateTitle(text: string): boolean {
  return THINKING_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Strip fences, quotes, and excess length from a model title string. */
export function normalizeTitle(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  // Remove markdown code fence markers.
  text = text.replace(/```+/g, '').trim();

  // Drop common prefixes models add despite instructions.
  text = text.replace(/^title:\s*/i, '').trim();

  // Collapse whitespace and trim wrapping quotes.
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
