import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
const DEFAULT_EDITOR_AI_COMPLETION = {
  enabled: true,
  debounceMs: 450,
  maxPrefixLines: 80,
  maxSuffixLines: 40,
  maxPrefixChars: 6000,
  maxSuffixChars: 2000,
  temperature: 0.3,
  maxTokens: 128,
  useChatModel: true,
  providerId: '',
  modelId: '',
};
import { fileEditorEscapeBlurBinding } from '../../src/ui/file-editor-keymap.ts';
import { fileEditorKeymapExtensions } from '../../src/ui/file-editor-keymap.ts';
import {
  acceptEditorAiGhost,
  dismissEditorAiGhost,
  editorAiCompletionExtensions,
  editorAiGhostKeymapBindings,
  hasEditorAiGhost,
  setEditorAiGhostForTest,
} from '../../src/ui/file-editor-ai-extensions.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
}

function mountEditorWithAi(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...fileEditorKeymapExtensions(),
        ...editorAiCompletionExtensions({
          filePath: 'test.ts',
          config: { ...DEFAULT_EDITOR_AI_COMPLETION, enabled: true },
          canRequest: () => false,
        }),
      ],
    }),
    parent,
  });
}

describe('file editor AI keymap', () => {
  test('Tab accepts ghost when active', () => {
    setupDom();
    const view = mountEditorWithAi('const ');
    const pos = view.state.doc.length;
    setEditorAiGhostForTest(view, 'x = 1;', pos);
    assert.equal(hasEditorAiGhost(view.state), true);

    const handled = editorAiGhostKeymapBindings[0].run!(view);
    assert.equal(handled, true);
    assert.equal(view.state.doc.toString(), 'const x = 1;');
    assert.equal(hasEditorAiGhost(view.state), false);
  });

  test('Tab indents when no ghost is active', () => {
    setupDom();
    const view = mountEditorWithAi('line');
    view.focus();
    const aiHandled = editorAiGhostKeymapBindings[0].run!(view);
    assert.equal(aiHandled, false);
    const indentHandled = indentWithTab.run(view);
    assert.equal(indentHandled, true);
    assert.equal(view.state.doc.toString(), '  line');
  });

  test('Escape dismisses ghost (preventDefault binding)', () => {
    setupDom();
    const view = mountEditorWithAi('abc');
    setEditorAiGhostForTest(view, 'ghost', 3);

    const dismissed = editorAiGhostKeymapBindings[1].run!(view);
    assert.equal(dismissed, true);
    assert.equal(hasEditorAiGhost(view.state), false);
    assert.equal(editorAiGhostKeymapBindings[1].preventDefault, true);
  });

  test('ghost Escape binding returns false when no ghost', () => {
    setupDom();
    const view = mountEditorWithAi('abc');
    const handled = editorAiGhostKeymapBindings[1].run!(view);
    assert.equal(handled, false);
  });

  test('acceptEditorAiGhost and dismissEditorAiGhost helpers', () => {
    setupDom();
    const view = mountEditorWithAi('fn(');
    setEditorAiGhostForTest(view, 'a, b', 3);
    assert.equal(acceptEditorAiGhost(view), true);
    assert.equal(view.state.doc.toString(), 'fn(a, b');

    setEditorAiGhostForTest(view, 'tmp', 6);
    assert.equal(dismissEditorAiGhost(view), true);
    assert.equal(view.state.doc.toString(), 'fn(a, b');
  });
});
