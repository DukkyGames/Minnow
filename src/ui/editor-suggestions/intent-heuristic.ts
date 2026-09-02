export type IntentLineKind = 'intent' | 'code' | 'skip';

export interface ClassifyIntentOptions {
  /** When set, only lines starting with this prefix are intent — the heuristic below is skipped entirely. */
  sigil?: string;
  /** Line-comment token for the file's language (e.g. `//`, `#`). */
  lineComment?: string;
}

/** Leading tokens that mark a line as code even when the rest reads as prose. */
const LEADING_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'return',
  'import',
  'const',
  'let',
  'var',
  'def',
  'class',
  'func',
  'fn',
  'pub',
]);

/** Languages whose files are prose by default — never auto-trigger intent there. */
const PROSE_LANGUAGES = new Set([
  'markdown',
  'plain text',
  'text',
  'restructuredtext',
  'asciidoc',
  'latex',
  'troff',
  'bibtex',
]);

const LINE_COMMENT_BY_LANGUAGE: Record<string, string> = {
  'c++': '//',
  c: '//',
  'c#': '//',
  'objective-c': '//',
  css: '/*',
  dart: '//',
  go: '//',
  groovy: '//',
  haskell: '--',
  java: '//',
  javascript: '//',
  jsx: '//',
  json: '//',
  julia: '#',
  kotlin: '//',
  less: '//',
  lua: '--',
  nix: '#',
  perl: '#',
  php: '//',
  powershell: '#',
  python: '#',
  r: '#',
  ruby: '#',
  rust: '//',
  scala: '//',
  scss: '//',
  shell: '#',
  sql: '--',
  swift: '//',
  toml: '#',
  tsx: '//',
  typescript: '//',
  'typescript react': '//',
  yaml: '#',
  zig: '//',
};

/** Line-comment token for a CodeMirror language name, or null when unknown. */
export function lineCommentForLanguage(languageName: string | null | undefined): string | null {
  const key = languageName?.trim().toLowerCase();
  if (!key) return null;
  return LINE_COMMENT_BY_LANGUAGE[key] ?? null;
}

/** True when intent may auto-trigger for a language. */
export function isIntentEligibleLanguage(languageName: string | null | undefined): boolean {
  const key = languageName?.trim().toLowerCase();
  if (!key) return false;
  return !PROSE_LANGUAGES.has(key);
}

/** Leading whitespace of a line. */
export function leadingWhitespace(text: string): string {
  return text.match(/^[\t ]*/)?.[0] ?? '';
}

/** True when a fragment reads as English prose rather than source code. */
export function looksLikeIntentProse(text: string): boolean {
  const body = text.trim();
  if (!body) return false;

  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;

  if (/[;{},)]$/.test(body)) return false;
  if (/(=>|::|->)/.test(body)) return false;
  if (/=/.test(body)) return false;
  if (/[A-Za-z_$][\w$]*\s*\(/.test(body)) return false;

  const first = tokens[0].toLowerCase().replace(/[^a-z]/g, '');
  if (LEADING_KEYWORDS.has(first)) return false;

  const wordy = tokens.filter((token) => /^[A-Za-z][a-z]*$/.test(token)).length;
  return wordy / tokens.length >= 0.6;
}

/** Classify one editor line for the intent auto-trigger. */
export function classifyIntentLine(
  lineText: string,
  opts: ClassifyIntentOptions = {},
): IntentLineKind {
  const trimmed = (lineText ?? '').trim();
  if (!trimmed) return 'skip';

  const sigil = opts.sigil?.trim();
  if (sigil) {
    if (!trimmed.startsWith(sigil)) return 'code';
    return trimmed.slice(sigil.length).trim() ? 'intent' : 'skip';
  }

  const comment = opts.lineComment?.trim();
  if (comment && trimmed.startsWith(comment)) {
    const body = trimmed.slice(comment.length).trim();
    if (!body) return 'skip';
    return looksLikeIntentProse(body) ? 'intent' : 'code';
  }

  return looksLikeIntentProse(trimmed) ? 'intent' : 'code';
}

/** Strip a sigil or comment marker, leaving the instruction the model receives. */
export function intentInstructionFromLine(
  lineText: string,
  opts: ClassifyIntentOptions = {},
): string {
  const trimmed = (lineText ?? '').trim();
  const sigil = opts.sigil?.trim();
  if (sigil && trimmed.startsWith(sigil)) {
    return trimmed.slice(sigil.length).trim();
  }
  const comment = opts.lineComment?.trim();
  if (comment && trimmed.startsWith(comment)) {
    return trimmed.slice(comment.length).trim();
  }
  return trimmed;
}
