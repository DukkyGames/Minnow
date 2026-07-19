/**

 * CodeMirror extensions for the file viewer — LSP autocomplete via local server.

 * Tab/Escape keymaps live in `file-editor-keymap.ts`.

 */



export {

  fileEditorEscapeBlurBinding,

  fileEditorKeymapBindings,

  fileEditorKeymapExtensions,

} from './file-editor-keymap';



import { autocompletion, snippet, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

import { Prec, type Extension } from '@codemirror/state';

import { EditorView, keymap } from '@codemirror/view';

import {

  fetchCompletions,

  resolveLspCompletion,

  type LspCompletionItem,

  type LspTextEdit,

} from '../lsp/completion-client';

import { lspEditorUxExtensions } from './lsp-editor';

import { lspCompletionKeymapBindings } from './file-editor-keymap';

import {

  buildLspCompletionContext,

  completionMenuFrom,

  isCompletionRequestValid,

  LSP_IDENTIFIER_MATCH,

  shouldOpenCompletionOnInput,

  toCmCompletion,

  waitForCompletionDebounce,

} from './lsp-completion-source';

import {

  lspRangeToSpan,

  lspTextEditToChange,

} from './lsp-editor/lsp-positions';



/** LSP InsertTextFormat — snippet placeholders use $0, $1, … */

const LSP_INSERT_TEXT_FORMAT_SNIPPET = 2;



function dispatchCompletionChanges(

  view: EditorView,

  from: number,

  to: number,

  insertText: string,

  extraEdits: LspTextEdit[] | undefined,

  isSnippet: boolean,

  completion: Completion,

): void {

  if (isSnippet) {

    const applySnippet = snippet(insertText);

    applySnippet(view, completion, from, to);

    if (extraEdits?.length) {

      view.dispatch({ changes: extraEdits.map((edit) => lspTextEditToChange(view, edit)) });

    }

    return;

  }



  const changes = [

    { from, to, insert: insertText },

    ...(extraEdits ?? []).map((edit) => lspTextEditToChange(view, edit)),

  ];

  view.dispatch({

    changes,

    selection: { anchor: from + insertText.length },

  });

}



function resolveReplaceSpan(

  view: EditorView,

  item: LspCompletionItem,

  fallbackFrom: number,

  fallbackTo: number,

): { from: number; to: number } {

  const emptySelection = fallbackFrom === fallbackTo;

  if (item.textEditInsertRange && item.textEditReplaceRange) {

    const range = emptySelection ? item.textEditInsertRange : item.textEditReplaceRange;

    return lspRangeToSpan(view, range);

  }

  if (item.textEditRange) {

    return lspRangeToSpan(view, item.textEditRange);

  }

  return { from: fallbackFrom, to: fallbackTo };

}



function buildApply(filePath: string, item: LspCompletionItem): Completion['apply'] {

  const insertText = item.insertText;

  const isSnippet = item.insertTextFormat === LSP_INSERT_TEXT_FORMAT_SNIPPET;



  return (view, completion, from, to) => {

    const span = resolveReplaceSpan(view, item, from, to);

    const extraEdits = item.additionalTextEdits;



    if (extraEdits?.length || !item.data) {

      dispatchCompletionChanges(view, span.from, span.to, insertText, extraEdits, isSnippet, completion);

      return;

    }



    dispatchCompletionChanges(view, span.from, span.to, insertText, undefined, isSnippet, completion);

    void resolveLspCompletion(filePath, item).then((resolved) => {

      if (resolved?.additionalTextEdits?.length) {

        view.dispatch({

          changes: resolved.additionalTextEdits.map((edit) => lspTextEditToChange(view, edit)),

        });

      }

    });

  };

}



/**

 * LSP autocomplete + in-editor UX (diagnostics, hover, signature, definition).

 */

export function lspEditorExtensions(filePath: string): Extension[] {

  let triggerCharacters: string[] = [];

  let lastResultIncomplete = false;



  const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {

    if (!isCompletionRequestValid(context, triggerCharacters)) return null;



    context.addEventListener('abort', () => {}, { onDocChange: true });



    await waitForCompletionDebounce(context);

    if (context.aborted) return null;



    const pos = context.pos;

    const lineInfo = context.state.doc.lineAt(pos);

    const line = lineInfo.number - 1;

    const character = pos - lineInfo.from;

    const editorText = context.state.doc.toString();

    const lspContext = buildLspCompletionContext(

      context,

      triggerCharacters,

      lastResultIncomplete,

    );



    const response = await fetchCompletions(filePath, line, character, {

      editorText,

      context: lspContext,

    });



    if (context.aborted) return null;



    if (response.triggerCharacters?.length) {

      triggerCharacters = response.triggerCharacters;

    }

    lastResultIncomplete = response.isIncomplete === true;



    const items = response.items;

    if (items.length === 0) return null;



    const word = context.matchBefore(LSP_IDENTIFIER_MATCH);

    const wordFrom = word ? word.from : pos;



    const result: CompletionResult = {

      from: completionMenuFrom(context.state.doc, items, wordFrom),

      options: items.map((item) => toCmCompletion(filePath, item, buildApply(filePath, item))),

    };



    if (!response.isIncomplete) {

      result.validFor = LSP_IDENTIFIER_MATCH;

    }



    return result;

  };



  const triggerInputHandler = EditorView.inputHandler.of((view, _from, to, text) => {

    if (!shouldOpenCompletionOnInput(text, triggerCharacters)) return false;

    startCompletion(view);

    return false;

  });



  return [

    ...lspEditorUxExtensions(filePath),

    autocompletion({

      activateOnTyping: true,

      defaultKeymap: false,

      override: [completionSource],

    }),

    Prec.low(triggerInputHandler),

    Prec.highest(keymap.of(lspCompletionKeymapBindings)),

  ];

}

