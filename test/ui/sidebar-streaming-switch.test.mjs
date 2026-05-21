import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject, getActiveChat } = await import(
  '../../src/state/sessions.ts'
);
const { switchChat } = await import('../../src/ui/sidebar.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  document.body.appendChild(modelSelect);

  const sendBtn = document.createElement('button');
  sendBtn.id = 'sendBtn';
  sendBtn.type = 'button';
  document.body.appendChild(sendBtn);

  const msgInput = document.createElement('textarea');
  msgInput.id = 'msgInput';
  document.body.appendChild(msgInput);

  const inputBar = document.createElement('div');
  inputBar.className = 'input-bar-composer';
  document.body.appendChild(inputBar);

  for (const id of [
    'stripTPS',
    'stripTTFT',
    'stripGen',
    'stripTotal',
    'barPrompt',
    'barCompletion',
    'cntPrompt',
    'cntCompletion',
    'iArch',
    'iQuant',
    'iCtx',
    'iStop',
    'statsExpandPreview',
  ]) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }

  return window;
}

describe('switchChat while another chat streams', { concurrency: false }, () => {
  afterEach(() => {
    appState.setStreaming(false);
    setSessionStateForTests(null);
  });

  test('switchChat succeeds without blocking when stream is on another chat', () => {
    setupDom();
    const a = createEmptyChatObject('');
    a.id = 'chat-streaming';
    a.name = 'Streaming';
    a.history.push({ role: 'user', content: 'hi' });

    const b = createEmptyChatObject('');
    b.id = 'chat-target';
    b.name = 'Target';
    b.history.push({ role: 'user', content: 'other' });

    setSessionStateForTests({
      version: 2,
      activeId: a.id,
      sidebarCollapsed: false,
      chats: [a, b],
    });

    appState.setStreaming(true, a.id);
    switchChat(b.id);

    assert.equal(getActiveChat().id, b.id);
    assert.equal(appState.streamingChatId, a.id);
    assert.equal(appState.streaming, true);

    const hint = document.getElementById('composerBackgroundStreamHint');
    assert.ok(hint);
    assert.ok(!hint.classList.contains('hidden'));
    assert.match(hint.textContent ?? '', /Streaming/);
  });
});
