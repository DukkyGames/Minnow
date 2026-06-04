/**
 * CodeMirror keymaps for the file viewer (Tab indent / LSP accept, Escape blur).
 * Kept separate from LSP extensions so tests avoid the tools client graph.
 */

import {
  acceptCompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
  startCompletion,
} from '@codemirror/autocomplete';
import { indentLess, indentMore } from '@codemirror/commands';
import { Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';

/**
 * LSP dropdown navigation (Tab accept is on {@link fileEditorTabBinding}).
 * Enter is intentionally omitted so it inserts a newline while the menu is open.
 */
export const lspCompletionKeymapBindings: KeyBinding[] = [
  { key: 'Ctrl-Space', run: startCompletion },
  { mac: 'Alt-`', run: startCompletion },
  { mac: 'Alt-i', run: startCompletion },
  { key: 'Escape', run: closeCompletion },
  { key: 'ArrowDown', run: moveCompletionSelection(true) },
  { key: 'ArrowUp', run: moveCompletionSelection(false) },
  { key: 'PageDown', run: moveCompletionSelection(true, 'page') },
  { key: 'PageUp', run: moveCompletionSelection(false, 'page') },
];

/** Tab accepts an open LSP menu; otherwise indents. AI ghost Tab runs at higher precedence. */
export const fileEditorTabBinding: KeyBinding = {
  key: 'Tab',
  run: (view: EditorView) => {
    if (completionStatus(view.state) === 'active') {
      return acceptCompletion(view);
    }
    return indentMore(view);
  },
  shift: indentLess,
};

/** Blur the editor on Escape so Tab can navigate the rest of Minnow. */
export const fileEditorEscapeBlurBinding: KeyBinding = {
  key: 'Escape',
  run: (view: EditorView) => {
    view.dom.blur();
    return true;
  },
};

/** Tab indent/outdent (or LSP accept) and Escape blur bindings. */
export const fileEditorKeymapBindings: KeyBinding[] = [
  fileEditorTabBinding,
  fileEditorEscapeBlurBinding,
];

/**
 * Shared file-viewer keymaps: Tab/Shift+Tab (LSP accept or indent), Escape blur.
 * Runs above {@link editorCoreExtensions} defaultKeymap Tab/Escape.
 */
export function fileEditorKeymapExtensions(): Extension[] {
  return [Prec.high(keymap.of(fileEditorKeymapBindings))];
}
