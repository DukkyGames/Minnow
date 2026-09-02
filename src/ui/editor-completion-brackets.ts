const OPENERS = new Set(['(', '[', '{']);
const CLOSER_FOR: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
};
const OPENER_FOR: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

type ScanStyle = 'c-like' | 'python' | 'plain';

function scanStyleForFenceLang(fenceLang: string): ScanStyle {
  const lang = fenceLang.toLowerCase();
  if (lang === 'python') return 'python';
  if (lang === 'markdown' || lang === 'yaml') return 'plain';
  return 'c-like';
}

interface ScanState {
  stack: string[];
}

function pushOpen(stack: string[], ch: string): void {
  if (OPENERS.has(ch)) stack.push(ch);
}

function popIfMatches(stack: string[], ch: string): void {
  const open = OPENER_FOR[ch];
  if (!open) return;
  if (stack.length > 0 && stack[stack.length - 1] === open) {
    stack.pop();
  }
}

/** Scan one code unit, skipping comments and string literals per language style. */
function scanSegment(
  text: string,
  start: number,
  style: ScanStyle,
  state: ScanState,
): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (style === 'c-like') {
      if (ch === '/' && next === '/') {
        const nl = text.indexOf('\n', i);
        i = nl < 0 ? text.length : nl + 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? text.length : end + 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        i = skipQuoted(text, i, ch);
        continue;
      }
    } else if (style === 'python') {
      if (ch === '#') {
        const nl = text.indexOf('\n', i);
        i = nl < 0 ? text.length : nl + 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const triple = text.slice(i, i + 3);
        if (triple === '"""' || triple === "'''") {
          const end = text.indexOf(triple, i + 3);
          i = end < 0 ? text.length : end + 3;
          continue;
        }
        i = skipQuoted(text, i, ch);
        continue;
      }
    }

    if (OPENERS.has(ch)) {
      pushOpen(state.stack, ch);
    } else if (OPENER_FOR[ch]) {
      popIfMatches(state.stack, ch);
    }
    i += 1;
  }
  return i;
}

function skipQuoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/** Bracket opener stack after scanning prefix (strings/comments ignored). */
export function bracketStackFromPrefix(prefix: string, fenceLang: string): string[] {
  const style = scanStyleForFenceLang(fenceLang);
  const state: ScanState = { stack: [] };
  scanSegment(prefix, 0, style, state);
  return [...state.stack];
}

function trimTrailingClosersPresentInSuffix(
  text: string,
  suffix: string,
  stack: string[],
): string {
  let result = text;
  let suffixIdx = 0;
  while (result.length > 0) {
    const closer = result[result.length - 1]!;
    const open = OPENER_FOR[closer];
    if (!open || stack.length === 0 || stack[stack.length - 1] !== open) break;
    if (suffix[suffixIdx] !== closer) break;
    result = result.slice(0, -1);
    stack.pop();
    suffixIdx += 1;
  }
  return result;
}

function appendMissingClosersForStack(text: string, stack: string[]): string {
  if (stack.length === 0) return text;
  let closers = '';
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const open = stack[i]!;
    closers += CLOSER_FOR[open] ?? '';
  }
  return text + closers;
}

export interface AlignCompletionBracketsResult {
  text: string;
  rejected: boolean;
  reason?: 'unbalanced';
}

/**
 * Align bracket structure for an inline completion after overlap trimming.
 */
export function alignCompletionBrackets(
  text: string,
  prefix: string,
  suffix: string,
  fenceLang: string,
): AlignCompletionBracketsResult {
  if (!text) return { text: '', rejected: false };

  const style = scanStyleForFenceLang(fenceLang);
  const stack = bracketStackFromPrefix(prefix, fenceLang);

  const state: ScanState = { stack };
  scanSegment(text, 0, style, state);
  if (state.stack.length > 2) {
    return { text: '', rejected: true, reason: 'unbalanced' };
  }

  let aligned = trimTrailingClosersPresentInSuffix(text, suffix, state.stack);

  const suffixLine = suffix.split('\n')[0] ?? '';
  if (/^\s*$/.test(suffixLine)) {
    aligned = appendMissingClosersForStack(aligned, state.stack);
  }

  return { text: aligned, rejected: false };
}
