import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { LspPosition, LspRange, LspTextEdit } from '../../lsp/completion-client';

/** Offset in the document for an LSP position (clamped to doc bounds). */
export function lspPositionToOffsetFromDoc(
  doc: EditorState['doc'],
  position: LspPosition,
): number {
  const line = Math.min(Math.max(0, position.line), doc.lines - 1);
  const lineInfo = doc.line(line + 1);
  const col = Math.min(Math.max(0, position.character), lineInfo.length);
  return lineInfo.from + col;
}

/** Span for an LSP range using a document (no EditorView). */
export function lspRangeToSpanFromDoc(
  doc: EditorState['doc'],
  range: LspRange,
): { from: number; to: number } {
  return {
    from: lspPositionToOffsetFromDoc(doc, range.start),
    to: lspPositionToOffsetFromDoc(doc, range.end),
  };
}

/** Offset in the document for an LSP position (clamped to doc bounds). */
export function lspPositionToOffset(view: EditorView, position: LspPosition): number {
  const doc = view.state.doc;
  const line = Math.min(Math.max(0, position.line), doc.lines - 1);
  const lineInfo = doc.line(line + 1);
  const col = Math.min(Math.max(0, position.character), lineInfo.length);
  return lineInfo.from + col;
}

/** CM6 change spec from an LSP text edit. */
export function lspTextEditToChange(
  view: EditorView,
  edit: LspTextEdit,
): { from: number; to: number; insert: string } {
  return {
    from: lspPositionToOffset(view, edit.range.start),
    to: lspPositionToOffset(view, edit.range.end),
    insert: edit.newText,
  };
}

/** LSP line/character at a document offset. */
export function offsetToLspPosition(view: EditorView, offset: number): LspPosition {
  const lineInfo = view.state.doc.lineAt(offset);
  return {
    line: lineInfo.number - 1,
    character: offset - lineInfo.from,
  };
}

/** Span for an LSP range. */
export function lspRangeToSpan(
  view: EditorView,
  range: LspRange,
): { from: number; to: number } {
  return {
    from: lspPositionToOffset(view, range.start),
    to: lspPositionToOffset(view, range.end),
  };
}
