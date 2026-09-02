import { indentUnit } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { fetchLspDocumentFormat } from '../../lsp/completion-client';
import { applyLspTextEditsToString } from './apply-lsp-edits';
import { lspTextEditToChange } from './lsp-positions';

export interface FormatDocumentOptions {
  path: string;
  tabSize?: number;
  insertSpaces?: boolean;
}

/** Request whole-document formatting and apply edits in one undo step. */
export async function formatDocumentInView(
  view: EditorView,
  options: FormatDocumentOptions,
): Promise<boolean> {
  const text = view.state.doc.toString();
  const unit = view.state.facet(indentUnit);
  const result = await fetchLspDocumentFormat(options.path, {
    text,
    tabSize: options.tabSize ?? view.state.tabSize,
    insertSpaces: options.insertSpaces ?? unit !== '\t',
  });
  if (!result.edits.length) return false;
  view.dispatch({
    changes: result.edits.map((edit) => lspTextEditToChange(view, edit)),
  });
  return true;
}

/** Format buffer text via LSP (for save hook); returns original text when formatting unavailable. */
export async function formatTextForSave(
  path: string,
  text: string,
  languageIds: string[],
  languageId: string,
): Promise<string> {
  if (!languageIds.length || !languageIds.includes(languageId)) return text;
  const result = await fetchLspDocumentFormat(path, { text });
  if (!result.edits.length) return text;
  return applyLspTextEditsToString(text, result.edits);
}
