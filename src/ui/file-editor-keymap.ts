/**
 * CodeMirror keymaps for the file viewer (Tab indent, Escape blur).
 * Kept separate from LSP extensions so tests avoid the tools client graph.
 */

import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';

/** Blur the editor on Escape so Tab can navigate the rest of Minnow. */
export const fileEditorEscapeBlurBinding: KeyBinding = {
  key: 'Escape',
  run: (view: EditorView) => {
    view.dom.blur();
    return true;
  },
};

/** Tab indent/outdent and Escape blur bindings. */
export const fileEditorKeymapBindings: KeyBinding[] = [
  indentWithTab,
  fileEditorEscapeBlurBinding,
];

/**
 * Shared file-viewer keymaps: 2-space indent unit, Tab/Shift+Tab, Escape blur.
 */
export function fileEditorKeymapExtensions(): Extension[] {
  return [indentUnit.of('  '), keymap.of(fileEditorKeymapBindings)];
}
