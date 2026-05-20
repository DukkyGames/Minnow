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
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { fetchCompletions, type LspCompletionItem } from '../lsp/completion-client';

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

function toCmCompletion(item: LspCompletionItem): Completion {
  return {
    label: item.label,
    detail: item.detail,
    type: completionTypeFromKind(item.kind),
    apply: item.insertText,
  };
}

/**
 * Autocomplete override that queries POST /api/lsp/completion for the open file.
 */
export function lspEditorExtensions(filePath: string): Extension[] {
  return [
    autocompletion({
      activateOnTyping: true,
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

          return {
            from: word ? word.from : pos,
            options: items.map(toCmCompletion),
          };
        },
      ],
    }),
  ];
}
