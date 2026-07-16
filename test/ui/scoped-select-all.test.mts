import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

function setupDom(html: string): Window {
  const win = new Window();
  win.document.body.innerHTML = html;
  globalThis.window = win as unknown as Window & typeof globalThis;
  globalThis.document = win.document;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;
  return win;
}

const {
  findSelectionScope,
  isDelegatedSelectAllTarget,
  isSelectAllShortcut,
  rememberSelectionScope,
  resetScopedSelectAllStateForTests,
  resolveSelectionScopeForSelectAll,
  selectAllInElement,
  shouldHandleScopedSelectAll,
} = await import('../../src/ui/scoped-select-all.ts');

describe('scoped select-all', { concurrency: false }, () => {
  test('isSelectAllShortcut accepts Ctrl+A and Cmd+A', () => {
    assert.equal(
      isSelectAllShortcut({
        type: 'keydown',
        key: 'a',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      true,
    );
    assert.equal(
      isSelectAllShortcut({
        type: 'keydown',
        key: 'A',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      }),
      true,
    );
  });

  test('isSelectAllShortcut rejects modified or non-select-all chords', () => {
    assert.equal(
      isSelectAllShortcut({
        type: 'keydown',
        key: 'a',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
      false,
    );
    assert.equal(
      isSelectAllShortcut({
        type: 'keyup',
        key: 'a',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      false,
    );
  });

  test('findSelectionScope resolves chat, editor, and preview roots', () => {
    const win = setupDom(`
      <main id="chatArea"><p class="msg">hello</p></main>
      <div id="fileViewerHost"><div class="cm-editor">code</div></div>
      <div id="previewBody"><p>preview</p></div>
    `);
    const chatMsg = win.document.querySelector('.msg')!;
    const editor = win.document.querySelector('.cm-editor')!;
    const preview = win.document.querySelector('#previewBody p')!;

    assert.equal(findSelectionScope(chatMsg)?.id, 'chatArea');
    assert.equal(findSelectionScope(editor)?.id, 'fileViewerHost');
    assert.equal(findSelectionScope(preview)?.id, 'previewBody');
  });

  test('isDelegatedSelectAllTarget skips native and embedded editors', () => {
    const win = setupDom(`
      <textarea id="composer"></textarea>
      <div class="cm-editor" tabindex="0"></div>
      <div class="xterm"></div>
    `);
    assert.equal(isDelegatedSelectAllTarget(win.document.getElementById('composer')), true);
    assert.equal(isDelegatedSelectAllTarget(win.document.querySelector('.cm-editor')), true);
    assert.equal(isDelegatedSelectAllTarget(win.document.querySelector('.xterm')), true);
    assert.equal(isDelegatedSelectAllTarget(win.document.body), false);
  });

  test('shouldHandleScopedSelectAll uses active scope or last focused panel', () => {
    resetScopedSelectAllStateForTests();
    const event = {
      type: 'keydown',
      key: 'a',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    const win = setupDom('<main id="chatArea"><p>hello</p></main>');
    const chatArea = win.document.getElementById('chatArea')!;

    assert.equal(shouldHandleScopedSelectAll(event, win.document.body, null), false);

    rememberSelectionScope(chatArea);
    assert.equal(shouldHandleScopedSelectAll(event, win.document.body, chatArea), true);
    assert.equal(
      shouldHandleScopedSelectAll(event, win.document.querySelector('p'), chatArea),
      true,
    );
  });

  test('resolveSelectionScopeForSelectAll prefers the active panel over memory', () => {
    const win = setupDom(`
      <main id="chatArea"><p>chat</p></main>
      <div id="previewBody"><p>preview</p></div>
    `);
    const chatArea = win.document.getElementById('chatArea')!;
    const previewParagraph = win.document.querySelector('#previewBody p')!;

    assert.equal(
      resolveSelectionScopeForSelectAll(previewParagraph, chatArea)?.id,
      'previewBody',
    );
  });

  test('selectAllInElement selects only the scoped panel contents', () => {
    const win = setupDom(`
      <aside id="sidebar">sidebar</aside>
      <main id="chatArea"><p id="msg">hello chat</p></main>
    `);
    const chatArea = win.document.getElementById('chatArea')!;
    const selection = win.getSelection()!;

    selectAllInElement(chatArea);

    assert.equal(selection.rangeCount, 1);
    const selected = selection.toString();
    assert.match(selected, /hello chat/);
    assert.doesNotMatch(selected, /sidebar/);
  });
});
