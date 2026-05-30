/**
 * CodeMirror extensions for AI inline ghost-text completions (POLISH-006).
 */

import {
  EditorSelection,
  StateEffect,
  StateField,
  type Extension,
  type EditorState,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import {
  fetchEditorAiCompletion,
  resolveEditorAiBinding,
} from './editor-ai-completion-client';

export interface EditorAiExtensionOptions {
  filePath: string;
  config: EditorAiCompletionConfig;
  /** When false, no requests are made (npm start / provider offline). */
  canRequest: () => boolean;
  onStatus?: (message: string | null) => void;
}

interface AiGhostValue {
  text: string;
  pos: number;
}

const setAiGhost = StateEffect.define<AiGhostValue | null>();

const aiGhostField = StateField.define<AiGhostValue | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAiGhost)) return effect.value;
    }
    if (tr.docChanged) return null;
    if (tr.selection && !tr.selection.eq(tr.startState.selection)) return null;
    return value;
  },
});

class GhostTextWidget extends WidgetType {
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

const aiGhostDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_prev, tr) {
    const ghost = tr.state.field(aiGhostField);
    if (!ghost?.text) return Decoration.none;
    const mark = Decoration.widget({
      widget: new GhostTextWidget(ghost.text),
      side: 1,
    });
    return Decoration.set([mark.range(ghost.pos)]);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** True when a ghost suggestion is visible. */
export function hasEditorAiGhost(state: EditorState): boolean {
  const ghost = state.field(aiGhostField, false);
  return Boolean(ghost?.text);
}

/** Insert the active ghost at its anchor and clear suggestion state. */
export function acceptEditorAiGhost(view: EditorView): boolean {
  const ghost = view.state.field(aiGhostField, false);
  if (!ghost?.text) return false;
  const insertPos = ghost.pos;
  view.dispatch({
    changes: { from: insertPos, insert: ghost.text },
    effects: setAiGhost.of(null),
    selection: EditorSelection.cursor(insertPos + ghost.text.length),
  });
  return true;
}

/** Clear ghost without modifying the document. */
export function dismissEditorAiGhost(view: EditorView): boolean {
  if (!hasEditorAiGhost(view.state)) return false;
  view.dispatch({ effects: setAiGhost.of(null) });
  return true;
}

/** Test helper: show a ghost at the given position. */
export function setEditorAiGhostForTest(
  view: EditorView,
  text: string,
  pos: number,
): void {
  view.dispatch({ effects: setAiGhost.of({ text, pos }) });
}

/** Tab accepts ghost when present; otherwise returns false for indent. */
export const editorAiTabBinding: KeyBinding = {
  key: 'Tab',
  run: (view) => acceptEditorAiGhost(view),
};

/** Escape dismisses ghost when present; otherwise returns false for blur. */
export const editorAiEscapeBinding: KeyBinding = {
  key: 'Escape',
  run: (view) => dismissEditorAiGhost(view),
};

class EditorAiCompletionPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private requestPos = -1;

  constructor(
    private readonly view: EditorView,
    private readonly opts: EditorAiExtensionOptions,
  ) {}

  update(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet) return;
    this.cancelInFlight();
    if (update.state.readOnly) return;
    if (!this.opts.canRequest()) {
      this.opts.onStatus?.('AI completion unavailable (start npm start and configure a provider).');
      return;
    }
    this.opts.onStatus?.(null);

    const pos = update.state.selection.main.head;
    if (update.selectionSet && !update.docChanged) {
      return;
    }

    this.schedule(pos);
  }

  destroy(): void {
    this.cancelInFlight();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private schedule(pos: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const delay = this.opts.config.debounceMs;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.requestCompletion(pos);
    }, delay);
  }

  private cancelInFlight(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async requestCompletion(pos: number): Promise<void> {
    const { state } = this.view;
    if (state.readOnly) return;
    if (state.selection.main.head !== pos) return;

    this.cancelInFlight();
    const controller = new AbortController();
    this.abortController = controller;
    this.requestPos = pos;

    const binding = await resolveEditorAiBinding(this.opts.config);
    const text = await fetchEditorAiCompletion({
      state,
      cursorPos: pos,
      filePath: this.opts.filePath,
      config: this.opts.config,
      binding,
      signal: controller.signal,
    });

    if (controller.signal.aborted) return;
    if (this.view.state.selection.main.head !== pos) return;
    if (this.requestPos !== pos) return;

    if (!text) {
      this.view.dispatch({ effects: setAiGhost.of(null) });
      return;
    }

    this.view.dispatch({
      effects: setAiGhost.of({ text, pos }),
    });
  }
}

/** Ghost UI, debounced LLM requests, Tab accept, Esc dismiss. Register after base keymaps. */
export function editorAiCompletionExtensions(
  opts: EditorAiExtensionOptions,
): Extension[] {
  return [
    aiGhostField,
    aiGhostDecorations,
    ViewPlugin.define((view) => new EditorAiCompletionPlugin(view, opts)),
    keymap.of([editorAiTabBinding, editorAiEscapeBinding]),
  ];
}
