/**
 * Lightweight guard: plans must not contain code snippets (MIN-235).
 */

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE_HEAVY = /(`[^`]+`){3,}/;

/** True when markdown likely contains code that should not appear in plans. */
export function planContainsCodeSnippets(markdown: string): boolean {
  const text = markdown.trim();
  if (!text) return false;
  if (FENCED_CODE.test(text)) return true;
  if (INLINE_CODE_HEAVY.test(text)) return true;
  return false;
}
