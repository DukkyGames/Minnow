import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { syncComposerFromStreamingState } = await import('../../src/ui/composer-send.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  const host = document.createElement('div');
  host.className = 'input-bar-composer';
  document.body.appendChild(host);

  const sendBtn = document.createElement('button');
  sendBtn.id = 'sendBtn';
  sendBtn.type = 'button';
  document.body.appendChild(sendBtn);

  const msgInput = document.createElement('textarea');
  msgInput.id = 'msgInput';
  document.body.appendChild(msgInput);

  return window;
}

describe('syncComposerFromStreamingState', () => {
  afterEach(() => {
    appState.setStreaming(false);
    setSessionStateForTests(null);
  });

  test('active chat streaming uses stop mode', () => {
    setupDom();
    const chat = createEmptyChatObject('');
    chat.id = 'c1';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    appState.setStreaming(true, chat.id);
    syncComposerFromStreamingState();

    const btn = document.getElementById('sendBtn');
    assert.equal(btn.dataset.mode, 'stop');
  });

  test('background stream shows hint and send mode on active chat', () => {
    setupDom();
    const a = createEmptyChatObject('');
    a.id = 'bg';
    a.name = 'Background';
    const b = createEmptyChatObject('');
    b.id = 'active';
    setSessionStateForTests({
      version: 2,
      activeId: b.id,
      sidebarCollapsed: false,
      chats: [a, b],
    });
    appState.setStreaming(true, a.id);
    syncComposerFromStreamingState();

    assert.equal(document.getElementById('sendBtn').dataset.mode, 'send');
    const hint = document.getElementById('composerBackgroundStreamHint');
    assert.ok(hint);
    assert.ok(!hint.classList.contains('hidden'));
  });
});
