import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { autocompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { Window } from 'happy-dom';
import {
  suggestionTabTarget,
  type SuggestionTabTarget,
} from '../../../src/ui/editor-completion-policy.ts';

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

function idleState(): EditorState {
  return EditorState.create({ doc: 'const a = 1;' });
}

/**
 * Drive LSP-busy through the real autocomplete state so the matrix asserts
 * against completionStatus rather than a stub.
 */
async function busyLspView(): Promise<EditorView> {
  setupDom();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: 'con',
      selection: { anchor: 3 },
      extensions: [
        autocompletion({
          override: [() => new Promise(() => {})],
          activateOnTyping: false,
        }),
      ],
    }),
    parent,
  });
  startCompletion(view);
  for (let i = 0; i < 100 && completionStatus(view.state) !== 'pending'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(completionStatus(view.state), 'pending');
  return view;
}

describe('suggestionTabTarget', () => {
  const idleCases: Array<{
    intent: boolean;
    completion: boolean;
    expected: SuggestionTabTarget;
  }> = [
    { intent: false, completion: false, expected: 'indent' },
    { intent: false, completion: true, expected: 'completion' },
    { intent: true, completion: false, expected: 'intent' },
    { intent: true, completion: true, expected: 'intent' },
  ];

  for (const row of idleCases) {
    test(`lsp=false intent=${row.intent} completion=${row.completion} → ${row.expected}`, () => {
      assert.equal(
        suggestionTabTarget(idleState(), { intent: row.intent, completion: row.completion }),
        row.expected,
      );
    });
  }

  for (const row of idleCases) {
    test(`lsp=true intent=${row.intent} completion=${row.completion} → lsp`, async () => {
      const view = await busyLspView();
      assert.equal(
        suggestionTabTarget(view.state, { intent: row.intent, completion: row.completion }),
        'lsp',
      );
      view.destroy();
    });
  }

  test('intent outranks completion when both are somehow visible', () => {
    assert.equal(
      suggestionTabTarget(idleState(), { intent: true, completion: true }),
      'intent',
    );
  });

  test('an idle editor with nothing visible falls through to indent', () => {
    assert.equal(
      suggestionTabTarget(idleState(), { intent: false, completion: false }),
      'indent',
    );
  });
});
