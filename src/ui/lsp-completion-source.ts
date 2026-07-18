/**
 * Testable helpers for LSP → CodeMirror completion mapping and trigger detection.
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionInfo,
  type CompletionSection,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import {
  resolveLspCompletion,
  type LspCompletionContext,
  type LspCompletionItem,
  type LspRange,
} from '../lsp/completion-client';

/** LSP CompletionContext.triggerKind values. */
export const LSP_COMPLETION_TRIGGER_INVOKED = 1;
export const LSP_COMPLETION_TRIGGER_CHARACTER = 2;
export const LSP_COMPLETION_TRIGGER_INCOMPLETE = 3;

/** Coalesce rapid keystrokes before hitting the LSP HTTP endpoint. */
export const LSP_COMPLETION_DEBOUNCE_MS = 100;

/** Identifier span for matchBefore / validFor — allows zero-length matches at trigger chars. */
export const LSP_IDENTIFIER_MATCH = /[\w$]*/;

/** Preselected LSP items get a strong boost in CodeMirror ranking. */
const LSP_PRESELECT_BOOST = 99;

/** Map LSP CompletionItemKind numbers to CodeMirror completion type hints. */
export function completionTypeFromKind(kind?: number): string | undefined {
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

/** Shared section headers — one object per section name for CodeMirror grouping. */
const COMPLETION_SECTIONS: Record<string, CompletionSection> = {
  Keywords: { name: 'Keywords', rank: 10 },
  Snippets: { name: 'Snippets', rank: 20 },
  Variables: { name: 'Variables', rank: 30 },
  Constants: { name: 'Constants', rank: 31 },
  Fields: { name: 'Fields', rank: 40 },
  Properties: { name: 'Properties', rank: 41 },
  'Enum members': { name: 'Enum members', rank: 42 },
  Methods: { name: 'Methods', rank: 50 },
  Functions: { name: 'Functions', rank: 51 },
  Constructors: { name: 'Constructors', rank: 52 },
  Classes: { name: 'Classes', rank: 60 },
  Interfaces: { name: 'Interfaces', rank: 61 },
  Structs: { name: 'Structs', rank: 62 },
  Enums: { name: 'Enums', rank: 63 },
  Modules: { name: 'Modules', rank: 70 },
  Files: { name: 'Files', rank: 80 },
  Folders: { name: 'Folders', rank: 81 },
  Events: { name: 'Events', rank: 90 },
  Operators: { name: 'Operators', rank: 91 },
  'Type parameters': { name: 'Type parameters', rank: 92 },
  Values: { name: 'Values', rank: 100 },
  Text: { name: 'Text', rank: 110 },
};

/** Map LSP CompletionItemKind to a grouped menu section heading. */
export function completionSectionFromKind(kind?: number): CompletionSection | undefined {
  if (kind == null) return undefined;
  const sectionByKind: Record<number, keyof typeof COMPLETION_SECTIONS> = {
    1: 'Text',
    2: 'Methods',
    3: 'Functions',
    4: 'Constructors',
    5: 'Fields',
    6: 'Variables',
    7: 'Classes',
    8: 'Interfaces',
    9: 'Modules',
    10: 'Properties',
    12: 'Values',
    13: 'Enums',
    14: 'Keywords',
    15: 'Snippets',
    17: 'Files',
    19: 'Folders',
    20: 'Enum members',
    21: 'Constants',
    22: 'Structs',
    23: 'Events',
    24: 'Operators',
    25: 'Type parameters',
  };
  const key = sectionByKind[kind];
  return key ? COMPLETION_SECTIONS[key] : undefined;
}

/** Character immediately before the cursor, or null at document start. */
export function charBeforeCursor(doc: EditorState['doc'], pos: number): string | null {
  if (pos <= 0) return null;
  return doc.sliceString(pos - 1, pos);
}

/** True when completion should run: explicit invoke, identifier prefix, or trigger char. */
export function isCompletionRequestValid(
  context: CompletionContext,
  triggerCharacters: readonly string[],
): boolean {
  if (context.explicit) return true;
  const word = context.matchBefore(LSP_IDENTIFIER_MATCH);
  if (word != null && word.text.length > 0) return true;
  const ch = charBeforeCursor(context.state.doc, context.pos);
  return ch != null && triggerCharacters.includes(ch);
}

/** Build LSP CompletionContext from CodeMirror state. */
export function buildLspCompletionContext(
  context: CompletionContext,
  triggerCharacters: readonly string[],
  afterIncompleteList: boolean,
): LspCompletionContext {
  if (context.explicit) {
    return { triggerKind: LSP_COMPLETION_TRIGGER_INVOKED };
  }
  if (afterIncompleteList) {
    return { triggerKind: LSP_COMPLETION_TRIGGER_INCOMPLETE };
  }
  const ch = charBeforeCursor(context.state.doc, context.pos);
  if (ch != null && triggerCharacters.includes(ch)) {
    return { triggerKind: LSP_COMPLETION_TRIGGER_CHARACTER, triggerCharacter: ch };
  }
  return { triggerKind: LSP_COMPLETION_TRIGGER_INVOKED };
}

/** Open completion immediately after a server-advertised trigger character. */
export function shouldOpenCompletionOnInput(
  ch: string,
  triggerCharacters: readonly string[],
): boolean {
  return triggerCharacters.includes(ch);
}

/** Composite dedup key — keeps distinct overloads with the same label. */
export function completionDedupKey(item: LspCompletionItem): string {
  return `${item.sortText ?? ''}\0${item.label}\0${item.detail ?? ''}\0${item.insertText}`;
}

/** Stable sort by LSP sortText (falls back to label). */
export function stableSortCompletionItems(items: LspCompletionItem[]): LspCompletionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const sa = a.item.sortText ?? a.item.label;
      const sb = b.item.sortText ?? b.item.label;
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function completionInfoFromDocumentation(
  documentation: LspCompletionItem['documentation'],
): string | undefined {
  if (documentation == null) return undefined;
  if (typeof documentation === 'string') {
    return documentation;
  }
  return documentation.value;
}

export type ResolveLspCompletionFn = (
  path: string,
  item: LspCompletionItem,
) => Promise<LspCompletionItem | null>;

/** Map one LSP item to a CodeMirror completion (ranking fields; apply supplied by caller). */
export function toCmCompletion(
  filePath: string,
  item: LspCompletionItem,
  apply: Completion['apply'],
  resolveCompletion: ResolveLspCompletionFn = resolveLspCompletion,
): Completion {
  const filterLabel = item.filterText ?? item.label;
  const completion: Completion = {
    label: filterLabel,
    detail: item.detail,
    type: completionTypeFromKind(item.kind),
    apply,
  };

  const inlineInfo = completionInfoFromDocumentation(item.documentation);
  if (inlineInfo != null) {
    completion.info = inlineInfo;
  } else if (item.data != null) {
    // CodeMirror calls info when an option is selected — lazy resolve via LSP.
    completion.info = async (): Promise<CompletionInfo> => {
      const resolved = await resolveCompletion(filePath, item);
      const text = completionInfoFromDocumentation(resolved?.documentation);
      if (text == null) return null;
      const dom = document.createElement('div');
      dom.textContent = text;
      return dom;
    };
  }

  const section = completionSectionFromKind(item.kind);
  if (section) {
    completion.section = section;
  }

  if (item.sortText != null) {
    completion.sortText = item.sortText;
  }
  if (item.preselect === true) {
    completion.boost = LSP_PRESELECT_BOOST;
  }
  if (item.commitCharacters?.length) {
    completion.commitCharacters = item.commitCharacters;
  }
  if (item.filterText != null && item.filterText !== item.label) {
    completion.displayLabel = item.label;
  }
  return completion;
}

/** Shrink menu `from` when LSP textEdit ranges start earlier than the matched word. */
export function completionMenuFrom(
  doc: EditorState['doc'],
  items: LspCompletionItem[],
  wordFrom: number,
): number {
  let from = wordFrom;
  for (const item of items) {
    const ranges = [
      item.textEditRange,
      item.textEditInsertRange,
      item.textEditReplaceRange,
    ].filter(Boolean) as LspRange[];
    for (const range of ranges) {
      const span = lspRangeSpanFromDoc(doc, range);
      from = Math.min(from, span.from);
    }
  }
  return from;
}

function lspRangeSpanFromDoc(doc: EditorState['doc'], range: LspRange): { from: number; to: number } {
  const startLine = doc.line(Math.min(Math.max(0, range.start.line), doc.lines - 1) + 1);
  const endLine = doc.line(Math.min(Math.max(0, range.end.line), doc.lines - 1) + 1);
  const fromCol = Math.min(Math.max(0, range.start.character), startLine.length);
  const toCol = Math.min(Math.max(0, range.end.character), endLine.length);
  return { from: startLine.from + fromCol, to: endLine.from + toCol };
}

/** Debounce helper — resolves early when the completion context is aborted. */
export function waitForCompletionDebounce(
  context: CompletionContext,
  ms: number = LSP_COMPLETION_DEBOUNCE_MS,
): Promise<void> {
  return new Promise((resolve) => {
    if (context.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    context.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { onDocChange: true },
    );
  });
}
