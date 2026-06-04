/**
 * CodeMirror keymap + extension hook for Quick Edit (Mod-K, Phase 4).
 */

import { Prec, type Extension } from '@codemirror/state';
import { keymap, type KeyBinding } from '@codemirror/view';
import { openQuickEditPanel } from './panel';

export interface QuickEditExtensionOptions {
  filePath: string;
  canRequest: () => boolean;
}

/** Mod-K opens quick edit when there is a non-empty selection. */
export function quickEditKeymapBindings(opts: QuickEditExtensionOptions): KeyBinding[] {
  return [
    {
      key: 'Mod-k',
      run: (view) => {
        if (!opts.canRequest()) return false;
        const sel = view.state.selection.main;
        if (sel.empty) return false;
        openQuickEditPanel(view, opts.filePath);
        return true;
      },
    },
  ];
}

/** Register Quick Edit keymap at high precedence (below AI ghost). */
export function editorQuickEditExtensions(opts: QuickEditExtensionOptions): Extension[] {
  return [Prec.high(keymap.of(quickEditKeymapBindings(opts)))];
}
