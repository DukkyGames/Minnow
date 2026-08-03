/**
 * Layer B: optional indentRange after accepting multi-line completion ghosts.
 */

import type { EditorState } from '@codemirror/state';
import type { ChangeSpec } from '@codemirror/state';
import { getIndentUnit, indentRange, indentUnit } from '@codemirror/language';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { fenceLangFromPath } from './editor-ai-completion-prompt';

/** Languages where auto-indent after accept would fight significant whitespace. */
export function isWhitespaceSignificantFenceLang(fenceLang: string): boolean {
  const lang = fenceLang.toLowerCase();
  return lang === 'python' || lang === 'yaml' || lang === 'markdown';
}

/** Build document change specs for accepting a completion ghost (with optional reindent). */
export function completionInsertChangeSpecs(
  state: EditorState,
  insertPos: number,
  text: string,
  filePath: string,
  config: EditorAiCompletionConfig,
): ChangeSpec | readonly ChangeSpec[] {
  const insertChange: ChangeSpec = { from: insertPos, insert: text };
  if (!text.includes('\n')) return insertChange;
  if (config.reindentOnAccept === false) return insertChange;

  const fenceLang = fenceLangFromPath(filePath);
  if (isWhitespaceSignificantFenceLang(fenceLang)) return insertChange;

  const insertedState = state.update({ changes: insertChange }).state;
  const end = insertPos + text.length;
  const indentChanges = indentRange(insertedState, insertPos, end);
  return [insertChange, indentChanges];
}

/** Indent unit string for alignment when state is available. */
export function indentUnitStrFromState(state: EditorState): string {
  const unit = state.facet(indentUnit);
  return unit.length > 0 ? unit : ' '.repeat(getIndentUnit(state));
}
