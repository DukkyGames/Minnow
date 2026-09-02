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
