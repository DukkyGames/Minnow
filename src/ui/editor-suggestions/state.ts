/**
 * Unified suggestion state for the editor: inline completion ghost text and
 * Intent proposals share one field, one effect, and one accept path.
 */

import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { nextPartialGhostChunk } from '../editor-ai-completion-prompt';
import { buildSuggestionDecorations } from './decorations';

/** Inline completion ghost text inserted at {@link CompletionSuggestion.pos}. */
export interface CompletionSuggestion {
  kind: 'completion';
  text: string;
  pos: number;
}

/**
 * Proposed replacement for the document range `[from, to)`. `intentText` is the
 * exact text the proposal was generated from — it is re-verified on every
 * transaction so a stale proposal can never be written to a shifted line.
 */
export interface IntentSuggestion {
  kind: 'intent';
  from: number;
  to: number;
  intentText: string;
  text: string;
  streaming: boolean;
}

export type Suggestion = CompletionSuggestion | IntentSuggestion;

/** Set or clear the visible suggestion. An explicit effect always wins. */
export const setSuggestion = StateEffect.define<Suggestion | null>();

/** Toggle Intent mode for one editor. */
export const setIntentEnabled = StateEffect.define<boolean>();

/** Per-editor Intent mode flag (session only — remembered per path by the viewer). */
export const intentEnabledField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setIntentEnabled)) next = effect.value;
    }
    return next;
  },
});

/** Whether Intent mode is active for this editor. */
export function isIntentEnabled(state: EditorState): boolean {
  return state.field(intentEnabledField, false) === true;
}

/** Toggle Intent mode; returns the new enabled flag. */
export function toggleIntentMode(view: EditorView): boolean {
  const next = !isIntentEnabled(view.state);
  view.dispatch({ effects: setIntentEnabled.of(next) });
  return next;
}

/** Set Intent mode explicitly (no-op when already in that state). */
export function setIntentMode(view: EditorView, enabled: boolean): void {
  if (isIntentEnabled(view.state) === enabled) return;
  view.dispatch({ effects: setIntentEnabled.of(enabled) });
}

/**
 * Map an intent anchor through a transaction and re-verify it still covers the
 * text it was generated from. This is what keeps a proposal from landing on an
 * unrelated line after lines are inserted above it.
 */
function mapIntentSuggestion(
  suggestion: IntentSuggestion,
  tr: Transaction,
): IntentSuggestion | null {
  let { from, to } = suggestion;
  if (tr.docChanged) {
    from = tr.changes.mapPos(from, 1);
    to = tr.changes.mapPos(to, -1);
    if (from >= to) return null;
    if (tr.state.doc.sliceString(from, to) !== suggestion.intentText) return null;
  }
  const head = tr.state.selection.main.head;
  if (head < from || head > to) return null;
  if (from === suggestion.from && to === suggestion.to) return suggestion;
  return { ...suggestion, from, to };
}

/** Resolve the suggestion for a transaction (effects, then invalidation rules). */
export function resolveSuggestionAfterTransaction(
  tr: Transaction,
  startSuggestion: Suggestion | null,
): Suggestion | null {
  let suggestion = startSuggestion;
  let explicitSet = false;
  for (const effect of tr.effects) {
    if (effect.is(setSuggestion)) {
      suggestion = effect.value;
      explicitSet = true;
    }
  }
  if (explicitSet) return suggestion;
  if (!suggestion) return null;

  if (suggestion.kind === 'completion') {
    if (tr.docChanged) return null;
    if (!tr.state.selection.eq(tr.startState.selection)) return null;
    return suggestion;
  }

  return mapIntentSuggestion(suggestion, tr);
}

interface SuggestionFieldValue {
  suggestion: Suggestion | null;
  decorations: DecorationSet;
}

/**
 * Value + decorations in one field so effect updates always repaint (separate
 * fields can miss decorations when read order races within one transaction).
 */
export const suggestionField = StateField.define<SuggestionFieldValue>({
  create: () => ({ suggestion: null, decorations: Decoration.none }),
  update(value, tr) {
    const suggestion = resolveSuggestionAfterTransaction(tr, value.suggestion);
    return {
      suggestion,
      decorations: buildSuggestionDecorations(suggestion, tr.state),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

/** Visible suggestion of any kind, or null. */
export function getSuggestion(state: EditorState): Suggestion | null {
  return state.field(suggestionField, false)?.suggestion ?? null;
}

/** Visible completion ghost, or null. */
export function getCompletionSuggestion(state: EditorState): CompletionSuggestion | null {
  const suggestion = getSuggestion(state);
  return suggestion?.kind === 'completion' && suggestion.text ? suggestion : null;
}

/** Visible intent proposal, or null. */
export function getIntentSuggestion(state: EditorState): IntentSuggestion | null {
  const suggestion = getSuggestion(state);
  return suggestion?.kind === 'intent' && suggestion.text ? suggestion : null;
}

/** True when a completion ghost is visible. */
export function hasCompletionSuggestion(state: EditorState): boolean {
  return getCompletionSuggestion(state) !== null;
}

/** True when an intent proposal is visible. */
export function hasIntentSuggestion(state: EditorState): boolean {
  return getIntentSuggestion(state) !== null;
}

/** True when any suggestion is visible. */
export function hasSuggestion(state: EditorState): boolean {
  return hasCompletionSuggestion(state) || hasIntentSuggestion(state);
}

/** Insert the visible ghost at its anchor and clear suggestion state. */
export function acceptCompletionGhost(view: EditorView): boolean {
  const ghost = getCompletionSuggestion(view.state);
  if (!ghost) return false;
  const insertPos = ghost.pos;
  view.dispatch({
    changes: { from: insertPos, insert: ghost.text },
    effects: setSuggestion.of(null),
    selection: EditorSelection.cursor(insertPos + ghost.text.length),
  });
  return true;
}

/** Accept the next word/line chunk from the visible ghost (Ctrl/Cmd-Right). */
export function acceptPartialCompletionGhost(view: EditorView): boolean {
  const ghost = getCompletionSuggestion(view.state);
  if (!ghost) return false;
  const chunk = nextPartialGhostChunk(ghost.text);
  if (!chunk) return false;
  const insertPos = ghost.pos;
  const remainder = ghost.text.slice(chunk.length);
  view.dispatch({
    changes: { from: insertPos, insert: chunk },
    effects: setSuggestion.of(
      remainder ? { kind: 'completion', text: remainder, pos: insertPos + chunk.length } : null,
    ),
    selection: EditorSelection.cursor(insertPos + chunk.length),
  });
  return true;
}

/**
 * Replace the intent line with the proposal. Re-verifies the anchor immediately
 * before dispatching; CodeMirror's own history is the undo path (no revert UI).
 */
export function acceptIntentProposal(view: EditorView): boolean {
  const proposal = getIntentSuggestion(view.state);
  if (!proposal) return false;
  const { from, to, text } = proposal;
  if (to > view.state.doc.length) return false;
  if (view.state.doc.sliceString(from, to) !== proposal.intentText) {
    view.dispatch({ effects: setSuggestion.of(null) });
    return false;
  }
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    effects: setSuggestion.of(null),
    userEvent: 'input.complete',
  });
  return true;
}

/** Clear any visible suggestion without touching the document. */
export function dismissSuggestion(view: EditorView): boolean {
  if (!hasSuggestion(view.state)) return false;
  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
}

/** Test helper: show a completion ghost at the given position. */
export function setCompletionSuggestionForTest(
  view: EditorView,
  text: string,
  pos: number,
): void {
  view.dispatch({ effects: setSuggestion.of({ kind: 'completion', text, pos }) });
}

/** Test helper: show an intent proposal over the given range. */
export function setIntentSuggestionForTest(
  view: EditorView,
  suggestion: Omit<IntentSuggestion, 'kind' | 'streaming'> & { streaming?: boolean },
): void {
  view.dispatch({
    effects: setSuggestion.of({
      kind: 'intent',
      streaming: false,
      ...suggestion,
    }),
  });
}
