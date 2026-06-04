/**
 * CodeMirror extensions for the file viewer — LSP autocomplete via local server.
 * Tab/Escape keymaps live in `file-editor-keymap.ts`.
 */

export {
  fileEditorEscapeBlurBinding,
  fileEditorKeymapBindings,
  fileEditorKeymapExtensions,
} from './file-editor-keymap';

import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import {
  fetchCompletions,
  resolveLspCompletion,
  type LspCompletionItem,
  type LspTextEdit,
} from '../lsp/completion-client';
import { lspEditorUxExtensions } from './lsp-editor';
import { lspCompletionKeymapBindings } from './file-editor-keymap';
import {
  lspRangeToSpan,
  lspRangeToSpanFromDoc,
  lspTextEditToChange,
} from './lsp-editor/lsp-positions';

/** LSP InsertTextFormat — snippet placeholders use $0, $1, … */
const LSP_INSERT_TEXT_FORMAT_SNIPPET = 2;

/** Map LSP CompletionItemKind numbers to CodeMirror completion type hints. */
function completionTypeFromKind(kind?: number): string | undefined {
  if (kind == null) return undefined;
  const map: Record<number, string> = {
    1: 'text',
    2: 'method',
    3: 'function',
    4: 'constructor',
    5: 'field',
    6: 'variable',
    7: 'class',
    8: 'interface',
    9: 'module',
    10: 'property',
    11: 'unit',
    12: 'value',
    13: 'enum',
    14: 'keyword',
    15: 'snippet',
    16: 'color',
    17: 'file',
    18: 'reference',
    19: 'folder',
    20: 'enumMember',
    21: 'constant',
    22: 'struct',
    23: 'event',
    24: 'operator',
    25: 'typeParameter',
  };
  return map[kind];
}

function documentationToInfo(
  documentation: LspCompletionItem['documentation'],
): Completion['info'] | undefined {
  if (documentation == null) return undefined;
  if (typeof documentation === 'string') {
    return documentation;
  }
  return documentation.value;
}

function dispatchCompletionChanges(
  view: import('@codemirror/view').EditorView,
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
  view: import('@codemirror/view').EditorView,
  item: LspCompletionItem,
  fallbackFrom: number,
  fallbackTo: number,
): { from: number; to: number } {
  if (item.textEditRange) {
    return lspRangeToSpan(view, item.textEditRange);
  }
  return { from: fallbackFrom, to: fallbackTo };
}

function completionMenuFrom(
  doc: import('@codemirror/state').EditorState['doc'],
  items: LspCompletionItem[],
  wordFrom: number,
): number {
  let from = wordFrom;
  for (const item of items) {
    if (item.textEditRange) {
      const span = lspRangeToSpanFromDoc(doc, item.textEditRange);
      from = Math.min(from, span.from);
    }
  }
  return from;
}

function buildApply(
  filePath: string,
  item: LspCompletionItem,
): Completion['apply'] {
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

function toCmCompletion(filePath: string, item: LspCompletionItem): Completion {
  return {
    label: item.label,
    detail: item.detail,
    type: completionTypeFromKind(item.kind),
    info: documentationToInfo(item.documentation),
    apply: buildApply(filePath, item),
  };
}

/**
 * LSP autocomplete + in-editor UX (diagnostics, hover, signature, definition).
 */
export function lspEditorExtensions(filePath: string): Extension[] {
  return [
    ...lspEditorUxExtensions(filePath),
    autocompletion({
      activateOnTyping: true,
      defaultKeymap: false,
      override: [
        async (context: CompletionContext): Promise<CompletionResult | null> => {
          const word = context.matchBefore(/[\w$]*/);
          if (!word && !context.explicit) return null;

          const pos = context.pos;
          const lineInfo = context.state.doc.lineAt(pos);
          const line = lineInfo.number - 1;
          const character = pos - lineInfo.from;

          const items = await fetchCompletions(filePath, line, character);
          if (items.length === 0) return null;

          const wordFrom = word ? word.from : pos;
          return {
            from: completionMenuFrom(context.state.doc, items, wordFrom),
            options: items.map((item) => toCmCompletion(filePath, item)),
          };
        },
      ],
    }),
    Prec.highest(keymap.of(lspCompletionKeymapBindings)),
  ];
}
