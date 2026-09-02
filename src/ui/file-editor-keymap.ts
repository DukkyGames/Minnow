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
import { shouldLspTabTakePrecedence } from './editor-completion-policy';

/** LSP dropdown navigation (Tab accept is on {@link fileEditorTabBinding}). */
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

/** Tab accepts an open LSP menu; blocks indent while LSP is pending. AI ghost Tab runs at higher precedence. */
export const fileEditorTabBinding: KeyBinding = {
  key: 'Tab',
  run: (view: EditorView) => {
    if (!shouldLspTabTakePrecedence(view.state)) {
      return indentMore(view);
    }
    if (completionStatus(view.state) === 'active') {
      acceptCompletion(view);
    }
    return true;
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

/** Close the active viewer tab (scoped to the Code editor). */
export const fileEditorCloseTabBinding: KeyBinding = {
  key: 'Mod-w',
  run: () => {
    void import('./file-viewer').then((m) => m.closeFileViewer());
    return true;
  },
};

/** Cycle viewer tabs forward/back (scoped to the Code editor). */
export const fileEditorCycleTabBinding: KeyBinding = {
  key: 'Mod-Tab',
  run: () => {
    void import('./file-viewer').then((m) => m.cycleViewerTab('next'));
    return true;
  },
  shift: () => {
    void import('./file-viewer').then((m) => m.cycleViewerTab('prev'));
    return true;
  },
};

/** Tab indent/outdent (or LSP accept) and Escape blur bindings. */
export const fileEditorKeymapBindings: KeyBinding[] = [
  fileEditorTabBinding,
  fileEditorEscapeBlurBinding,
  fileEditorCloseTabBinding,
  fileEditorCycleTabBinding,
];

/** Shared file-viewer keymaps: Tab/Shift+Tab (LSP accept or indent), Escape blur. */
export function fileEditorKeymapExtensions(): Extension[] {
  return [Prec.high(keymap.of(fileEditorKeymapBindings))];
}
