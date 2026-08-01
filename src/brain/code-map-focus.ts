/**
 * Extract task hints for code-map injection (PageRank bias + optional focus filter).
 */

export interface CodeMapFocusHints {
  focusFiles: string[];
  /** Substring filter for repo map — only when a single confident token is found. */
  focus?: string;
}

const PATH_PREFIX_RE =
  /(?:^|[\s`'"(<@])((?:src|server|lib|documentation|docs|test|tests)\/[A-Za-z0-9_./-]+)/g;

const CAMEL_RE = /\b[A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]+)+\b/g;
const SNAKE_RE = /\b[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+\b/g;

const FOCUS_SKIP = new Set([
  'this',
  'that',
  'with',
  'from',
  'your',
  'please',
  'thanks',
  'hello',
  'minnow',
]);

/**
 * Normalize a workspace-relative path for focusFiles personalization.
 * @param {string} raw
 */
function normalizeFocusFile(raw: string): string | null {
  const t = String(raw ?? '').trim().replace(/\\/g, '/');
  if (!t) return null;
  if (t.startsWith('@')) return normalizeFocusFile(t.slice(1));
  if (/^(https?:|file:)/i.test(t)) return null;
  return t.replace(/^\/+/, '');
}

/**
 * Collect identifier-like tokens from user text (not the full message).
 * @param {string} text
 */
function collectFocusTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const m of text.matchAll(CAMEL_RE)) {
    const id = m[0];
    if (id.length >= 5 && !FOCUS_SKIP.has(id.toLowerCase())) terms.add(id);
  }
  for (const m of text.matchAll(SNAKE_RE)) {
    const id = m[0];
    if (id.length >= 6 && !FOCUS_SKIP.has(id)) terms.add(id);
  }
  return [...terms];
}

/**
 * Pick one focus substring when confident; otherwise rely on focusFiles rank bias only.
 * @param {string[]} focusFiles
 * @param {string[]} focusTerms
 */
function pickConfidentFocusTerm(focusFiles: string[], focusTerms: string[]): string | undefined {
  if (focusFiles.length === 1) {
    const base = focusFiles[0].split('/').pop() ?? '';
    const stem = base.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, '');
    if (stem.length >= 3) return stem;
  }
  if (focusTerms.length === 1) return focusTerms[0];
  const sorted = [...focusTerms].sort((a, b) => b.length - a.length);
  const best = sorted[0];
  if (best && best.length >= 8 && sorted.length > 1 && best.length >= sorted[1].length + 3) {
    return best;
  }
  return undefined;
}

/**
 * Build focus hints from the outgoing user message and attachment paths.
 */
export function extractCodeMapFocusHints(
  userMessagePreview: string,
  attachmentWorkspacePaths?: string[],
): CodeMapFocusHints {
  const focusFilesSet = new Set<string>();
  for (const raw of attachmentWorkspacePaths ?? []) {
    const norm = normalizeFocusFile(raw);
    if (norm) focusFilesSet.add(norm);
  }

  const text = String(userMessagePreview ?? '');
  for (const m of text.matchAll(PATH_PREFIX_RE)) {
    const norm = normalizeFocusFile(m[1]);
    if (norm) focusFilesSet.add(norm);
  }

  const focusFiles = [...focusFilesSet];
  const focusTerms = collectFocusTerms(text);
  const focus = pickConfidentFocusTerm(focusFiles, focusTerms);

  return focus ? { focusFiles, focus } : { focusFiles };
}
