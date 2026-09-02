import { Text } from '@codemirror/state';
import type { LspTextEdit } from '../../lsp/completion-client';
import { lspRangeToSpanFromDoc } from './lsp-positions';

/** Apply LSP edits to plain text; returns updated buffer. */
export function applyLspTextEditsToString(text: string, edits: LspTextEdit[]): string {
  if (!edits.length) return text;
  const doc = Text.of(text.split(/\r?\n/));
  const sorted = [...edits].sort((a, b) => {
    const spanA = lspRangeToSpanFromDoc(doc, a.range);
    const spanB = lspRangeToSpanFromDoc(doc, b.range);
    return spanB.from - spanA.from || spanB.to - spanA.to;
  });
  let next = text;
  for (const edit of sorted) {
    const fresh = Text.of(next.split(/\r?\n/));
    const { from, to } = lspRangeToSpanFromDoc(fresh, edit.range);
    next = fresh.sliceString(0, from) + edit.newText + fresh.sliceString(to);
  }
  return next;
}
