import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { EditorAiCompletionConfig } from '../../config/editor-ai-completion';

/** Build change specs replacing `[from, to)` with multi-line code (replace only). */
export function intentReplaceChangeSpecs(
  _state: EditorState,
  from: number,
  to: number,
  text: string,
  _filePath: string,
  _config: EditorAiCompletionConfig,
): ChangeSpec {
  return { from, to, insert: text };
}
