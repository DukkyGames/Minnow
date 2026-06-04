/**
 * CodeMirror 6 baseline extensions for the file viewer (history, keymaps, folding, search).
 */

import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  rectangularSelection,
} from '@codemirror/view';

export interface EditorCoreExtensionOptions {
  wordWrap: boolean;
  tabSize: number;
  renderWhitespace?: boolean;
}

/** Shared CM6 baseline: undo, brackets, folding, find/replace, multi-cursor, selection niceties. */
export function editorCoreExtensions(options: EditorCoreExtensionOptions): Extension[] {
  const tab = Math.min(8, Math.max(1, Math.round(options.tabSize)));
  const indent = ' '.repeat(tab);

  const whitespaceExts: Extension[] = options.renderWhitespace
    ? [highlightWhitespace(), highlightTrailingWhitespace()]
    : [];

  const wrapExts: Extension[] = options.wordWrap ? [EditorView.lineWrapping] : [];

  const lowPriorityKeymap = Prec.low(
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
  );

  return [
    history(),
    closeBrackets(),
    bracketMatching(),
    foldGutter(),
    codeFolding(),
    indentUnit.of(indent),
    indentOnInput(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    search({ top: true }),
    highlightSelectionMatches(),
    ...whitespaceExts,
    ...wrapExts,
    lowPriorityKeymap,
  ];
}
