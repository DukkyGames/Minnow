/**
 * Intent mode has to be visible and has to fire. Both regressed at once: the
 * line-decoration CSS was deleted while the decorations that emit it stayed,
 * and the idle auto-trigger was gated behind a setting that defaults to off.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Window } from 'happy-dom';
import { DEFAULT_EDITOR_AI_COMPLETION } from '../../../src/config/editor-ai-completion.ts';
import {
  DEFAULT_EDITOR_INTENT_MODE,
  type EditorIntentModeConfig,
} from '../../../src/config/editor-intent-mode.ts';
import {
  editorSuggestionBaseExtensions,
  editorSuggestionCompartmentExtension,
  editorSuggestionExtensions,
  mountEditorSuggestions,
} from '../../../src/ui/editor-suggestions/index.ts';
import type { ResolveIntentInput } from '../../../src/ui/editor-suggestions/intent-prompt.ts';
import {
  acceptIntentProposal,
  setIntentSuggestionForTest,
} from '../../../src/ui/editor-suggestions/state.ts';

const INTENT_CSS = fileURLToPath(
  new URL('../../../src/styles/editor-intent-mode.css', import.meta.url),
);

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window();
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document as unknown as Document;
  globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.Node = window.Node as unknown as typeof Node;
  globalThis.MutationObserver = window.MutationObserver as unknown as typeof MutationObserver;
  globalThis.ResizeObserver = window.ResizeObserver as unknown as typeof ResizeObserver;
}

afterEach(() => {
  domWindow?.close();
  domWindow = null;
});

const DOC = 'const items = [];\ncount the items in the list\nconst b = 2;\n';

interface Harness {
  view: EditorView;
  resolves: ResolveIntentInput[];
}

function mount(intentConfig: Partial<EditorIntentModeConfig> = {}): Harness {
  setupDom();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const resolves: ResolveIntentInput[] = [];
  const opts = {
    filePath: 'demo.ts',
    getConfig: () => ({ ...DEFAULT_EDITOR_AI_COMPLETION, enabled: true }),
    getIntentConfig: () => ({
      ...DEFAULT_EDITOR_INTENT_MODE,
      debounceMs: 100,
      ...intentConfig,
    }),
    canRequest: () => true,
    resolveIntentFn: async (input: ResolveIntentInput) => {
      resolves.push(input);
      return { text: 'const total = items.length;' };
    },
  };
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        ...editorSuggestionBaseExtensions(),
        editorSuggestionCompartmentExtension(editorSuggestionExtensions(opts)),
      ],
    }),
    parent,
  });
  mountEditorSuggestions(view, true);
  return { view, resolves };
}

function lineDecorationClasses(view: EditorView, pos: number): string[] {
  const classes: string[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === 'function' ? source(view) : source;
    set.between(pos, pos, (_from, _to, value) => {
      const spec = value.spec as { class?: string };
      if (spec.class) classes.push(spec.class);
    });
  }
  return classes;
}

describe('intent mode visibility', () => {
  test('every line class the decorations emit has a rule in the stylesheet', () => {
    const css = readFileSync(INTENT_CSS, 'utf8');
    for (const cls of [
      'cm-intent-line--pending',
      'cm-intent-line--resolved',
      'cm-intent-line--stale',
      'cm-intent-source',
      'cm-intent-proposal',
    ]) {
      assert.ok(css.includes(`.${cls}`), `${cls} has no rule in editor-intent-mode.css`);
    }
  });

  test('an intent line under the cursor is marked pending', () => {
    const { view } = mount();
    const line = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(line.from + 2) });
    assert.deepEqual(lineDecorationClasses(view, line.from), ['cm-intent-line--pending']);
    view.destroy();
  });

  test('a code line under the cursor is not marked', () => {
    const { view } = mount();
    const line = view.state.doc.line(3);
    view.dispatch({ selection: EditorSelection.cursor(line.from + 2) });
    assert.deepEqual(lineDecorationClasses(view, line.from), []);
    view.destroy();
  });
});

describe('accepting an intent proposal', () => {
  test('leaves the rest of the file alone and lands the cursor on the new block', () => {
    const { view } = mount();
    // Deliberately mis-indented trailing lines: reindent must not reach them.
    const doc = 'function run() {\n  build the list\n        const tail = 1;\n}\n';
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    const line = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(line.from + 2) });

    const replacement = '  const list = [];\n  list.push(1);';
    setIntentSuggestionForTest(view, {
      from: line.from,
      to: line.to,
      intentText: line.text,
      text: replacement,
    });
    assert.equal(acceptIntentProposal(view), true);

    assert.equal(
      view.state.doc.toString(),
      'function run() {\n  const list = [];\n  list.push(1);\n        const tail = 1;\n}\n',
    );
    assert.equal(view.state.selection.main.head, line.from + replacement.length);
    view.destroy();
  });
});

describe('intent auto-trigger', () => {
  test('idling on an intent line resolves without autoResolveOnLineLeave', async () => {
    const { view, resolves } = mount({ autoResolveOnLineLeave: false });
    const line = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(line.to) });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(resolves.length, 1);
    assert.equal(resolves[0]?.intentText, 'count the items in the list');
    view.destroy();
  });

  test('idling on a code line does not resolve', async () => {
    const { view, resolves } = mount();
    const line = view.state.doc.line(3);
    view.dispatch({ selection: EditorSelection.cursor(line.to) });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(resolves.length, 0);
    view.destroy();
  });

  test('leaving an intent line resolves it when autoResolveOnLineLeave is on', async () => {
    const { view, resolves } = mount({ autoResolveOnLineLeave: true });
    const intentLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(intentLine.to) });
    const codeLine = view.state.doc.line(3);
    view.dispatch({ selection: EditorSelection.cursor(codeLine.to) });
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(
      resolves.some((input) => input.intentText === 'count the items in the list'),
      'the line the cursor left should still be resolved',
    );
    view.destroy();
  });
});
