/**
 * Apply an accepted intent proposal with optional indentRange (Layer B).
 */

import type { ChangeSpec, EditorState } from '@codemirror/state';
import { indentRange } from '@codemirror/language';
import type { EditorAiCompletionConfig } from '../../config/editor-ai-completion';
import { isWhitespaceSignificantFenceLang } from '../editor-completion-accept';
import { fenceLangFromPath } from '../editor-ai-completion-prompt';

/** Build change specs replacing `[from, to)` with multi-line code (reindent on accept). */
export function intentReplaceChangeSpecs(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  filePath: string,
  config: EditorAiCompletionConfig,
): ChangeSpec | readonly ChangeSpec[] {
  const replace: ChangeSpec = { from, to, insert: text };
  if (!text.includes('\n')) return replace;
  if (config.reindentOnAccept === false) return replace;

  const fenceLang = fenceLangFromPath(filePath);
  if (isWhitespaceSignificantFenceLang(fenceLang)) return replace;

  const insertedState = state.update({ changes: replace }).state;
  const end = from + text.length;
  return [replace, indentRange(insertedState, from, end)];
}
