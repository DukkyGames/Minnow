export {
  editorSuggestionCompartment as editorAiCompletionCompartment,
  editorSuggestionExtensions as editorAiCompletionExtensions,
  editorSuggestionKeymapBindings as editorAiGhostKeymapBindings,
} from './editor-suggestions/index';

export { editorSuggestionKeymapBindings } from './editor-suggestions/keymap';

import { editorSuggestionKeymapBindings } from './editor-suggestions/keymap';

/** Tab accept binding (index 0). */
export const editorAiTabBinding = editorSuggestionKeymapBindings[0];

/** Escape dismiss binding — index 2 (after Mod-ArrowRight partial accept). */
export const editorAiEscapeBinding = editorSuggestionKeymapBindings[2];

export type { AiGhostValue, CompletionSuggestion } from './editor-suggestions/state';
