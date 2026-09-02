import type { EditorState } from '@codemirror/state';
import type { ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { getIndentUnit, indentRange, indentUnit } from '@codemirror/language';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { fenceLangFromPath } from './editor-ai-completion-prompt';

/** Languages where auto-indent after accept would fight significant whitespace. */
export function isWhitespaceSignificantFenceLang(fenceLang: string): boolean {
  const lang = fenceLang.toLowerCase();
  return lang === 'python' || lang === 'yaml' || lang === 'markdown';
}

export function shouldReindentOnAccept(
  text: string,
  filePath: string,
  config: EditorAiCompletionConfig,
): boolean {
  if (!text.includes('\n')) return false;
  if (config.reindentOnAccept === false) return false;
  if (!filePath.trim()) return false;
  const fenceLang = fenceLangFromPath(filePath);
  return !isWhitespaceSignificantFenceLang(fenceLang);
}

/** Build document change specs for accepting a completion ghost (insert only). */
export function completionInsertChangeSpecs(
  _state: EditorState,
  insertPos: number,
  text: string,
  _filePath: string,
  _config: EditorAiCompletionConfig,
): ChangeSpec {
  return { from: insertPos, insert: text };
}

/** Apply optional indentRange after an insert/replace dispatch. */
export function dispatchReindentAfterAccept(
  view: EditorView,
  rangeFrom: number,
  rangeTo: number,
  filePath: string,
  config: EditorAiCompletionConfig,
  insertedText: string,
): void {
  if (!shouldReindentOnAccept(insertedText, filePath, config)) return;
  const indentChanges = indentRange(view.state, rangeFrom, rangeTo);
  if (indentChanges) view.dispatch({ changes: indentChanges });
}

/** Cursor position after insert (+ optional reindent) relative to the pre-accept document. */
export function mappedEndAfterInsert(
  stateBefore: EditorState,
  insertPos: number,
  stateAfter: EditorState,
): number {
  if (insertPos === stateBefore.doc.length) return stateAfter.doc.length;
  const growth = stateAfter.doc.length - stateBefore.doc.length;
  return insertPos + growth;
}

/** Indent unit string for alignment when state is available. */
export function indentUnitStrFromState(state: EditorState): string {
  const unit = state.facet(indentUnit);
  return unit.length > 0 ? unit : ' '.repeat(getIndentUnit(state));
}
