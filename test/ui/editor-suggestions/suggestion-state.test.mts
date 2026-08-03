/**
 * Regression suite for the reported duplication bug: an intent proposal is
 * anchored to document positions that CodeMirror maps, and is re-verified
 * against the text it was generated from, so it can never be written to an
 * unrelated line.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Window } from 'happy-dom';
import {
  acceptCompletionGhost,
  acceptIntentProposal,
  acceptPartialCompletionGhost,
  dismissSuggestion,
  getIntentSuggestion,
  hasCompletionSuggestion,
  hasIntentSuggestion,
  hasSuggestion,
  intentEnabledField,
  isIntentEnabled,
  setCompletionSuggestionForTest,
  setIntentSuggestionForTest,
  suggestionField,
  toggleIntentMode,
} from '../../../src/ui/editor-suggestions/state.ts';

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

function mount(doc: string): EditorView {
  setupDom();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [suggestionField, intentEnabledField],
    }),
    parent,
  });
}

/** Show a proposal for the given 1-based line and park the cursor on it. */
function proposeOnLine(view: EditorView, lineNumber: number, text: string): void {
  const line = view.state.doc.line(lineNumber);
  view.dispatch({ selection: EditorSelection.cursor(line.to) });
  setIntentSuggestionForTest(view, {
    from: line.from,
    to: line.to,
    intentText: line.text,
    text,
  });
}

describe('intent anchor mapping', () => {
  test('survives an insertion above and shifts with its line', () => {
    const view = mount('const a = 1;\nfetch users and sort by name\nconst b = 2;');
    proposeOnLine(view, 2, 'const users = await fetchUsers();');
    const before = getIntentSuggestion(view.state);
    assert.ok(before);

    // Simulate lines arriving above while the proposal is on screen.
    view.dispatch({ changes: { from: 0, insert: 'import x from "y";\nimport z from "w";\n' } });

    const after = getIntentSuggestion(view.state);
    assert.ok(after, 'proposal should survive an edit above its anchor');
    assert.equal(after!.from, before!.from + 38);
    assert.equal(after!.to, before!.to + 38);
    assert.equal(
      view.state.doc.sliceString(after!.from, after!.to),
      'fetch users and sort by name',
    );
    assert.equal(view.state.doc.lineAt(after!.from).number, 4);
  });

  test('accepting after an insertion above replaces the right line', () => {
    const view = mount('const a = 1;\nfetch users and sort by name\nconst b = 2;');
    proposeOnLine(view, 2, 'const users = await fetchUsers();');
    view.dispatch({ changes: { from: 0, insert: 'import x from "y";\n' } });

    assert.equal(acceptIntentProposal(view), true);
    assert.equal(
      view.state.doc.toString(),
      'import x from "y";\nconst a = 1;\nconst users = await fetchUsers();\nconst b = 2;',
    );
    assert.equal(hasSuggestion(view.state), false);
  });

  test('clears when the intent line itself is edited', () => {
    const view = mount('fetch users and sort by name');
    proposeOnLine(view, 1, 'const users = await fetchUsers();');
    assert.equal(hasIntentSuggestion(view.state), true);

    const line = view.state.doc.line(1);
    view.dispatch({ changes: { from: line.from + 5, insert: 'X' } });
    assert.equal(hasIntentSuggestion(view.state), false);
  });

  test('clears when the anchored range is deleted', () => {
    const view = mount('const a = 1;\nfetch users and sort by name\nconst b = 2;');
    proposeOnLine(view, 2, 'const users = await fetchUsers();');
    const line = view.state.doc.line(2);
    view.dispatch({ changes: { from: line.from, to: line.to } });
    assert.equal(hasIntentSuggestion(view.state), false);
  });

  test('clears when the whole document is replaced', () => {
    const view = mount('fetch users and sort by name');
    proposeOnLine(view, 1, 'const users = await fetchUsers();');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'something else' } });
    assert.equal(hasIntentSuggestion(view.state), false);
  });

  test('clears when the cursor leaves the anchored line', () => {
    const view = mount('fetch users and sort by name\nconst b = 2;');
    proposeOnLine(view, 1, 'const users = await fetchUsers();');
    assert.equal(hasIntentSuggestion(view.state), true);

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(2).from) });
    assert.equal(hasIntentSuggestion(view.state), false);
  });

  test('survives cursor movement inside the anchored line', () => {
    const view = mount('fetch users and sort by name');
    proposeOnLine(view, 1, 'const users = await fetchUsers();');
    view.dispatch({ selection: EditorSelection.cursor(3) });
    assert.equal(hasIntentSuggestion(view.state), true);
  });

  test('accept refuses when the anchor text no longer matches', () => {
    const view = mount('fetch users and sort by name');
    const line = view.state.doc.line(1);
    view.dispatch({ selection: EditorSelection.cursor(line.to) });
    // Anchor deliberately stale — the range holds different text.
    setIntentSuggestionForTest(view, {
      from: line.from,
      to: line.to,
      intentText: 'a completely different intent',
      text: 'const users = [];',
    });
    assert.equal(acceptIntentProposal(view), false);
    assert.equal(view.state.doc.toString(), 'fetch users and sort by name');
    assert.equal(hasSuggestion(view.state), false);
  });

  test('accepting places the cursor at the end of the inserted block', () => {
    const view = mount('fetch users and sort by name');
    proposeOnLine(view, 1, 'const users = await fetchUsers();\nusers.sort();');
    assert.equal(acceptIntentProposal(view), true);
    assert.equal(
      view.state.doc.toString(),
      'const users = await fetchUsers();\nusers.sort();',
    );
    assert.equal(view.state.selection.main.head, view.state.doc.length);
  });
});

describe('completion suggestion invalidation', () => {
  test('clears on any document change', () => {
    const view = mount('const ');
    setCompletionSuggestionForTest(view, 'a = 1;', view.state.doc.length);
    assert.equal(hasCompletionSuggestion(view.state), true);
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    assert.equal(hasCompletionSuggestion(view.state), false);
  });

  test('clears on any selection change', () => {
    const view = mount('const a = 1;');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    setCompletionSuggestionForTest(view, ' // done', view.state.doc.length);
    assert.equal(hasCompletionSuggestion(view.state), true);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    assert.equal(hasCompletionSuggestion(view.state), false);
  });

  test('accept inserts at the anchor and clears', () => {
    const view = mount('const ');
    setCompletionSuggestionForTest(view, 'x = 1;', view.state.doc.length);
    assert.equal(acceptCompletionGhost(view), true);
    assert.equal(view.state.doc.toString(), 'const x = 1;');
    assert.equal(hasSuggestion(view.state), false);
  });

  test('partial accept keeps the remainder anchored after the inserted chunk', () => {
    const view = mount('a');
    setCompletionSuggestionForTest(view, 'bc def', 1);
    assert.equal(acceptPartialCompletionGhost(view), true);
    assert.equal(view.state.doc.toString(), 'abc ');
    assert.equal(hasCompletionSuggestion(view.state), true);
    assert.equal(view.state.field(suggestionField).suggestion?.kind, 'completion');
  });

  test('dismiss clears without touching the document', () => {
    const view = mount('abc');
    setCompletionSuggestionForTest(view, 'ghost', 3);
    assert.equal(dismissSuggestion(view), true);
    assert.equal(view.state.doc.toString(), 'abc');
    assert.equal(dismissSuggestion(view), false);
  });
});

describe('intent mode flag', () => {
  test('toggles and survives unrelated transactions', () => {
    const view = mount('const a = 1;');
    assert.equal(isIntentEnabled(view.state), false);
    assert.equal(toggleIntentMode(view), true);
    assert.equal(isIntentEnabled(view.state), true);
    view.dispatch({ changes: { from: 0, insert: '// x\n' } });
    assert.equal(isIntentEnabled(view.state), true);
    assert.equal(toggleIntentMode(view), false);
    assert.equal(isIntentEnabled(view.state), false);
  });
});
