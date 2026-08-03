/**
 * The single suggestion keymap. Registered at Prec.highest so LSP autocomplete
 * and the desktop shell cannot steal Tab (focus) or Escape (blur) first —
 * bindings that return false still fall through to the file editor keymap.
 */

import type { KeyBinding } from '@codemirror/view';
import { suggestionTabTarget } from '../editor-completion-policy';
import { forceIntentResolve } from './engine';
import {
  acceptCompletionGhost,
  acceptIntentProposal,
  acceptPartialCompletionGhost,
  dismissSuggestion,
  hasCompletionSuggestion,
  hasIntentSuggestion,
  toggleIntentMode,
} from './state';

export const editorSuggestionKeymapBindings: KeyBinding[] = [
  {
    key: 'Tab',
    preventDefault: true,
    run: (view) => {
      const target = suggestionTabTarget(view.state, {
        intent: hasIntentSuggestion(view.state),
        completion: hasCompletionSuggestion(view.state),
      });
      if (target === 'intent') return acceptIntentProposal(view);
      if (target === 'completion') return acceptCompletionGhost(view);
      // 'lsp' → the LSP keymap handles it; 'indent' → fileEditorTabBinding does.
      return false;
    },
  },
  {
    key: 'Mod-ArrowRight',
    preventDefault: true,
    run: (view) => acceptPartialCompletionGhost(view),
  },
  {
    key: 'Escape',
    preventDefault: true,
    run: (view) => dismissSuggestion(view),
  },
  {
    key: 'Mod-Enter',
    preventDefault: true,
    run: (view) => forceIntentResolve(view),
  },
  {
    key: 'Mod-i',
    preventDefault: true,
    run: (view) => {
      toggleIntentMode(view);
      return true;
    },
  },
];
