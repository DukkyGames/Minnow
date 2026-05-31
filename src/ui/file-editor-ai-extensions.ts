/**
 * CodeMirror extensions for AI inline ghost-text completions (POLISH-006).
 */

import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type EditorState,
  type Transaction,
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

/** Resolve ghost value for a transaction (effects + doc/selection invalidation). */
function resolveGhostAfterTransaction(
  tr: Transaction,
  startGhost: AiGhostValue | null,
): AiGhostValue | null {
  let ghost = startGhost;
  let explicitSet = false;
  for (const effect of tr.effects) {
    if (effect.is(setAiGhost)) {
      ghost = effect.value;
      explicitSet = true;
    }
  }
  if (explicitSet) return ghost;
  if (tr.docChanged) return null;
  if (!tr.state.selection.eq(tr.startState.selection)) return null;
  return ghost;
}

function buildGhostDecorations(ghost: AiGhostValue | null): DecorationSet {
  if (!ghost?.text) return Decoration.none;
  const mark = Decoration.widget({
    widget: new GhostTextWidget(ghost.text),
    side: 1,
  });
  return Decoration.set([mark.range(ghost.pos)]);
}

/**
 * Single field for ghost value + decorations so effect updates always repaint
 * (separate fields can miss decorations when read order races in one transaction).
 */
const aiGhostField = StateField.define<{
  ghost: AiGhostValue | null;
  decorations: DecorationSet;
}>({
  create: () => ({ ghost: null, decorations: Decoration.none }),
  update(value, tr) {
    const ghost = resolveGhostAfterTransaction(tr, value.ghost);
    return {
      ghost,
      decorations: buildGhostDecorations(ghost),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
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

/** True when a ghost suggestion is visible. */
export function hasEditorAiGhost(state: EditorState): boolean {
  const row = state.field(aiGhostField, false);
  return Boolean(row?.ghost?.text);
}

/** Insert the active ghost at its anchor and clear suggestion state. */
export function acceptEditorAiGhost(view: EditorView): boolean {
  const row = view.state.field(aiGhostField, false);
  const ghost = row?.ghost;
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
    this.cancelInFlight(update.docChanged);
    if (update.state.readOnly) return;
    if (!this.opts.canRequest()) {
      this.opts.onStatus?.('AI completion unavailable (start npm start and configure a provider).');
      return;
    }
    this.opts.onStatus?.(null);

    if (update.selectionSet && !update.docChanged) {
      return;
    }

    const pos = update.state.selection.main.head;
    this.schedule(pos);
  }

  destroy(): void {
    this.cancelInFlight(false);
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

  /** Abort in-flight completion; optionally clear visible ghost. */
  private cancelInFlight(clearGhost: boolean): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (clearGhost && hasEditorAiGhost(this.view.state)) {
      this.view.dispatch({ effects: setAiGhost.of(null) });
    }
  }

  private showGhostAt(pos: number, text: string): void {
    if (!text) {
      this.view.dispatch({ effects: setAiGhost.of(null) });
      return;
    }
    if (this.view.state.selection.main.head !== pos) return;
    this.view.dispatch({
      effects: setAiGhost.of({ text, pos }),
    });
  }

  private async requestCompletion(pos: number): Promise<void> {
    const { state } = this.view;
    if (state.readOnly) return;
    if (state.selection.main.head !== pos) return;

    const controller = new AbortController();
    this.abortController = controller;
    this.requestPos = pos;

    try {
      const binding = await resolveEditorAiBinding(this.opts.config);
      const text = await fetchEditorAiCompletion({
        state,
        cursorPos: pos,
        filePath: this.opts.filePath,
        config: this.opts.config,
        binding,
        signal: controller.signal,
        onPartial: (partial) => {
          if (controller.signal.aborted) return;
          if (this.requestPos !== pos) return;
          this.showGhostAt(pos, partial);
        },
      });

      if (controller.signal.aborted) return;
      if (this.view.state.selection.main.head !== pos) return;
      if (this.requestPos !== pos) return;

      this.showGhostAt(pos, text ?? '');
      if (text) {
        this.opts.onStatus?.('AI suggestion ready — Tab to accept, Esc to dismiss');
      }
    } catch {
      this.opts.onStatus?.('AI completion failed — check provider and model in Settings');
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }
}

/** Ghost UI, debounced LLM requests, Tab accept, Esc dismiss. Register after base keymaps. */
export function editorAiCompletionExtensions(
  opts: EditorAiExtensionOptions,
): Extension[] {
  return [
    Prec.high(aiGhostField),
    ViewPlugin.define((view) => new EditorAiCompletionPlugin(view, opts)),
    Prec.high(keymap.of([editorAiTabBinding, editorAiEscapeBinding])),
  ];
}
