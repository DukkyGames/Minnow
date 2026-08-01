import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DEFAULT_EDITOR_INTENT_MODE } from '../../../src/config/editor-intent-mode.ts';
import {
  editorIntentModeExtensions,
  mountIntentModeEditor,
} from '../../../src/ui/editor-intent-mode/extensions.ts';
import {
  addIntentRegion,
  intentModeField,
  setIntentModeEnabled,
  shouldSkipIntentResolve,
} from '../../../src/ui/editor-intent-mode/state.ts';

import { setSessionStateForTests, createEmptyChatObject } from '../../../src/state/sessions.ts';

let domWindow: Window | null = null;

beforeEach(() => {
  const chat = createEmptyChatObject('intent-trigger-chat');
  setSessionStateForTests({ chats: [chat], activeId: chat.id });
});

afterEach(() => {
  domWindow?.close();
  domWindow = null;
});

function mountIntentEditor(
  doc: string,
  resolveLineFn: (input: { intentText: string }) => Promise<{ text: string | null }>,
): { view: EditorView; resolvedIntents: string[] } {
  domWindow = new Window();
  globalThis.window = domWindow;
  globalThis.document = domWindow.document;
  globalThis.HTMLElement = domWindow.HTMLElement;
  globalThis.MutationObserver = domWindow.MutationObserver;
  globalThis.ResizeObserver = domWindow.ResizeObserver;

  const parent = domWindow.document.createElement('div');
  domWindow.document.body.append(parent);

  const resolvedIntents: string[] = [];
  const config = { ...DEFAULT_EDITOR_INTENT_MODE };

  const state = EditorState.create({
    doc,
    extensions: [
      ...editorIntentModeExtensions({
        filePath: 'src/example.ts',
        config,
        canRequest: () => true,
        resolveLineFn: async (input) => {
          resolvedIntents.push(input.intentText);
          return resolveLineFn(input);
        },
      }),
    ],
  });

  const view = new EditorView({ state, parent });
  mountIntentModeEditor(view, true);
  return { view, resolvedIntents };
}

describe('shouldSkipIntentResolve', () => {
  test('skips when full line is unchanged resolved code', () => {
    let state = EditorState.create({
      doc: 'const x = 1;',
      extensions: [intentModeField],
    });
    state = state.update({ effects: [setIntentModeEnabled.of(true)] }).state;
    state = state.update({
      effects: [
        addIntentRegion.of({
          from: 0,
          to: 12,
          intentText: 'set x to 1',
          ctxHash: 'h',
          stale: false,
        }),
      ],
    }).state;

    assert.equal(shouldSkipIntentResolve(state, 1), true);
  });

  test('does not skip when region does not span the full line', () => {
    let state = EditorState.create({
      doc: 'const x = 1; // more',
      extensions: [intentModeField],
    });
    state = state.update({ effects: [setIntentModeEnabled.of(true)] }).state;
    state = state.update({
      effects: [
        addIntentRegion.of({
          from: 0,
          to: 12,
          intentText: 'set x to 1',
          ctxHash: 'h',
          stale: false,
        }),
      ],
    }).state;

    assert.equal(shouldSkipIntentResolve(state, 1), false);
  });
});

describe('Intent trigger scheduling', () => {
  test('resolves line A when cursor moves A to B to C without waiting for debounce', async () => {
    const { view, resolvedIntents } = mountIntentEditor(
      'intent line one\nsecond\nthird\n',
      async () => ({ text: null }),
    );

    const line1 = view.state.doc.line(1);
    view.dispatch({
      changes: { from: line1.from, to: line1.to, insert: 'funciton add(a,b' },
      selection: { anchor: line1.from },
      userEvent: 'input',
    });

    view.dispatch({
      selection: { anchor: view.state.doc.line(2).from },
    });
    view.dispatch({
      selection: { anchor: view.state.doc.line(3).from },
    });

    await new Promise<void>((r) => queueMicrotask(() => r()));
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(
      resolvedIntents.includes('funciton add(a,b'),
      `expected resolve for line A, got: ${resolvedIntents.join(', ')}`,
    );

    view.destroy();
  });

  test('does not resolve while staying on the same line after debounce', async () => {
    const config = { ...DEFAULT_EDITOR_INTENT_MODE, debounceMs: 30 };
    domWindow = new Window();
    globalThis.window = domWindow;
    globalThis.document = domWindow.document;
    globalThis.HTMLElement = domWindow.HTMLElement;
    globalThis.MutationObserver = domWindow.MutationObserver;
    globalThis.ResizeObserver = domWindow.ResizeObserver;

    const parent = domWindow.document.createElement('div');
    domWindow.document.body.append(parent);

    const resolvedIntents: string[] = [];
    const state = EditorState.create({
      doc: 'intent only\n',
      extensions: [
        ...editorIntentModeExtensions({
          filePath: 'src/example.ts',
          config,
          canRequest: () => true,
          resolveLineFn: async (input) => {
            resolvedIntents.push(input.intentText);
            return { text: 'const x = 1;' };
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent });
    mountIntentModeEditor(view, true);

    const line1 = view.state.doc.line(1);
    view.dispatch({
      changes: { from: line1.from, to: line1.to, insert: 'add two numbers' },
      selection: { anchor: line1.from + 'add two numbers'.length },
      userEvent: 'input',
    });

    await new Promise((r) => setTimeout(r, 80));

    assert.equal(
      resolvedIntents.length,
      0,
      `expected no resolve while on same line, got: ${resolvedIntents.join(', ')}`,
    );

    view.destroy();
  });
});
