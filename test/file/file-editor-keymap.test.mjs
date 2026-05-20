import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const {
  fileEditorEscapeBlurBinding,
  fileEditorKeymapBindings,
  fileEditorKeymapExtensions,
} = await import('../../src/ui/file-editor-keymap.ts');

function setupDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
  return window;
}

function mountEditor(doc) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: fileEditorKeymapExtensions(),
    }),
    parent,
  });
  return view;
}

describe('file editor keymap', () => {
  test('fileEditorKeymapBindings includes Tab indent and Escape blur', () => {
    assert.ok(fileEditorKeymapBindings.includes(indentWithTab));
    assert.ok(fileEditorKeymapBindings.includes(fileEditorEscapeBlurBinding));
    assert.equal(fileEditorEscapeBlurBinding.key, 'Escape');
  });

  test('fileEditorKeymapExtensions returns indent unit and keymap', () => {
    assert.equal(fileEditorKeymapExtensions().length, 2);
  });

  test('Tab indents the current line', () => {
    setupDom();
    const view = mountEditor('line');
    view.focus();
    const handled = indentWithTab.run(view);
    assert.equal(handled, true);
    assert.equal(view.state.doc.toString(), '  line');
  });

  test('Escape blurs the editor', () => {
    setupDom();
    const view = mountEditor('x');
    let blurCalled = false;
    view.dom.blur = () => {
      blurCalled = true;
    };
    const handled = fileEditorEscapeBlurBinding.run(view);
    assert.equal(handled, true);
    assert.equal(blurCalled, true);
  });
});
