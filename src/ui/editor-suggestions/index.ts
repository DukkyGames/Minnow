/**
 * Editor suggestions — one engine for inline completion ghost text and Intent
 * proposals. Public surface for the file viewer.
 */

import { Compartment, Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import { getEditorAiCompletionConfigSync } from '../../config/editor-ai-completion';
import { SuggestionEnginePlugin, type EditorSuggestionOptions } from './engine';
import { editorSuggestionKeymapBindings } from './keymap';
import {
  dismissSuggestion,
  hasSuggestion,
  intentEnabledField,
  setIntentEnabled,
  suggestionField,
} from './state';

/** Compartment for hot-reloading suggestions without remounting the editor. */
export const editorSuggestionCompartment = new Compartment();

/**
 * Always-on state that must survive compartment reconfiguration (the Intent
 * toggle would otherwise reset whenever Settings are saved).
 */
export function editorSuggestionBaseExtensions(): Extension[] {
  return [intentEnabledField];
}

/** Suggestion field, engine plugin, and the single Tab/Esc keymap. */
export function editorSuggestionExtensions(opts: EditorSuggestionOptions): Extension[] {
  return [
    Prec.high(suggestionField),
    ViewPlugin.define((view) => new SuggestionEnginePlugin(view, opts)),
    Prec.highest(keymap.of(editorSuggestionKeymapBindings)),
  ];
}

/** Wrap suggestion extensions in a compartment for hot configuration reload. */
export function editorSuggestionCompartmentExtension(active: Extension[]): Extension {
  return editorSuggestionCompartment.of(active);
}

/** Apply the initial Intent mode flag after EditorView construction. */
export function mountEditorSuggestions(view: EditorView, intentEnabled: boolean): void {
  view.dispatch({ effects: setIntentEnabled.of(intentEnabled) });
}

/**
 * Hot-apply editor settings without remounting CodeMirror. The bundle stays
 * mounted whenever requests are possible — inline completion being off must not
 * take Intent mode down with it.
 */
export function reconfigureEditorSuggestions(
  view: EditorView,
  opts: EditorSuggestionOptions,
): void {
  const config = opts.getConfig?.() ?? opts.config ?? getEditorAiCompletionConfigSync();
  const mounted = opts.canRequest();
  view.dispatch({
    effects: editorSuggestionCompartment.reconfigure(
      mounted ? editorSuggestionExtensions(opts) : [],
    ),
  });
  if ((!mounted || !config.enabled) && hasSuggestion(view.state)) {
    dismissSuggestion(view);
  }
}

export type { EditorSuggestionOptions } from './engine';
export {
  INTENT_FAILED_MESSAGE,
  INTENT_NO_CHANGE_MESSAGE,
  INTENT_READY_MESSAGE,
  forceIntentResolve,
  getSuggestionEngine,
} from './engine';
export { editorSuggestionKeymapBindings } from './keymap';
export {
  acceptCompletionGhost,
  acceptIntentProposal,
  acceptPartialCompletionGhost,
  dismissSuggestion,
  getCompletionSuggestion,
  getIntentSuggestion,
  getSuggestion,
  hasCompletionSuggestion,
  hasIntentSuggestion,
  hasSuggestion,
  intentEnabledField,
  isIntentEnabled,
  setCompletionSuggestionForTest,
  setIntentEnabled,
  setIntentMode,
  setIntentSuggestionForTest,
  setSuggestion,
  suggestionField,
  toggleIntentMode,
} from './state';
export type { CompletionSuggestion, IntentSuggestion, Suggestion } from './state';
export {
  classifyIntentLine,
  intentInstructionFromLine,
  isIntentEligibleLanguage,
  lineCommentForLanguage,
  looksLikeIntentProse,
} from './intent-heuristic';
export type { ClassifyIntentOptions, IntentLineKind } from './intent-heuristic';
export {
  alignIntentBlock,
  buildIntentMessages,
  finalizeIntentText,
  reindentBlock,
  resolveIntentSuggestion,
  systemPromptForIntent,
} from './intent-prompt';
export type { IntentResolveResult, ResolveIntentInput } from './intent-prompt';
