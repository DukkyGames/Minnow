import { fenceLangFromPath } from '../editor-ai-completion-prompt';

/** Build ```lang path:start-end fenced block for a selection. */
export function formatSelectionFence(
  text: string,
  filePath: string,
  fromLine: number,
  toLine: number,
): string {
  const lang = fenceLangFromPath(filePath);
  const header = lang
    ? `${lang} ${filePath}:${fromLine}-${toLine}`
    : `${filePath}:${fromLine}-${toLine}`;
  return `\`\`\`${header}\n${text}\n\`\`\``;
}

/** Insert fenced selection text into #msgInput and focus the composer. */
export function insertSelectionInComposer(fenced: string): void {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;

  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needsBreakBefore = before.length > 0 && !/\n\s*$/.test(before);
  const needsBreakAfter = after.length > 0 && !/^\s*\n/.test(after);
  const insert = `${needsBreakBefore ? '\n\n' : ''}${fenced}${needsBreakAfter ? '\n\n' : ''}`;
  input.value = before + insert + after;
  const caret = before.length + insert.length;
  input.selectionStart = caret;
  input.selectionEnd = caret;
  input.dispatchEvent(
    new (input.ownerDocument?.defaultView ?? globalThis).Event('input', {
      bubbles: true,
    }),
  );
  input.focus();
}

/** Resolve 1-based line numbers from a doc slice. */
export function lineNumbersForRange(
  doc: { lineAt: (pos: number) => { number: number } },
  from: number,
  to: number,
): { fromLine: number; toLine: number } {
  const fromLine = doc.lineAt(from).number;
  const toLine = doc.lineAt(Math.max(from, to - 1)).number;
  return { fromLine, toLine };
}
