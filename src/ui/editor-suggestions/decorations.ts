/**
 * Decorations for the two suggestion kinds: inline ghost text (completion) and
 * a block proposal rendered under the intent line.
 */

import type { EditorState } from '@codemirror/state';
import { Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import type { Suggestion } from './state';

/** Inline grey text rendered at the cursor for a pending completion. */
export class GhostTextWidget extends WidgetType {
  readonly ghostText: string;

  constructor(text: string) {
    super();
    this.ghostText = text;
  }

  eq(other: GhostTextWidget): boolean {
    return other.ghostText === this.ghostText;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ai-ghost-text';
    span.textContent = this.ghostText;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Block widget under the intent line showing the proposed replacement. A block
 * widget (rather than `Decoration.replace`) keeps the prose visible and
 * editable, and the gutter correctly declines to number lines that do not exist
 * in the document yet.
 */
export class IntentProposalWidget extends WidgetType {
  constructor(
    readonly proposalText: string,
    readonly streaming: boolean,
  ) {
    super();
  }

  eq(other: IntentProposalWidget): boolean {
    return (
      other.proposalText === this.proposalText && other.streaming === this.streaming
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = this.streaming
      ? 'cm-intent-proposal is-streaming'
      : 'cm-intent-proposal';
    wrap.setAttribute('aria-hidden', 'true');

    for (const line of this.proposalText.split('\n')) {
      const row = document.createElement('div');
      row.className = 'cm-intent-proposal-line';
      // Zero-width space keeps blank proposal lines from collapsing to 0px.
      row.textContent = line.length > 0 ? line : '​';
      wrap.appendChild(row);
    }

    const hint = document.createElement('span');
    hint.className = 'cm-intent-proposal-hint';
    hint.textContent = 'Tab accept · Esc dismiss';
    wrap.appendChild(hint);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Build the decoration set for the currently visible suggestion. */
export function buildSuggestionDecorations(
  suggestion: Suggestion | null,
  state: EditorState,
): DecorationSet {
  if (!suggestion?.text) return Decoration.none;

  if (suggestion.kind === 'completion') {
    const pos = Math.max(0, Math.min(suggestion.pos, state.doc.length));
    return Decoration.set([
      Decoration.widget({
        widget: new GhostTextWidget(suggestion.text),
        side: 1,
      }).range(pos),
    ]);
  }

  const anchor = Math.max(0, Math.min(suggestion.to, state.doc.length));
  const line = state.doc.lineAt(anchor);
  return Decoration.set(
    [
      Decoration.line({ class: 'cm-intent-source' }).range(line.from),
      Decoration.widget({
        widget: new IntentProposalWidget(suggestion.text, suggestion.streaming),
        side: 1,
        block: true,
      }).range(line.to),
    ],
    true,
  );
}
