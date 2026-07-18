import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { registerStreamDomRemount, remountStreamDomForChat } = await import(
  '../../src/tools/stream-chat-dom.ts'
);
const { setSidebarStreamPhase } = await import('../../src/ui/chat-item-dot.ts');
const { renderChatFromHistory } = await import('../../src/ui/messages.ts');
const { STREAM_LABEL_GENERATING, STREAM_LABEL_THINKING } = await import(
  '../../src/ui/stream-status.ts'
);

let activeWindow = null;

function setupDom() {
  activeWindow?.close();
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

  activeWindow = window;
  return window;
}

describe('stream-chat-dom remount', { concurrency: false }, () => {
  afterEach(() => {
    activeWindow?.close();
    activeWindow = null;
    appState.setStreaming(false);
    registerStreamDomRemount('chat-streaming', null);
    setSessionStateForTests(null);
  });

  test('remountStreamDomForChat restores Generating response… after history re-render', async () => {
    setupDom();
    const streaming = createEmptyChatObject('');
    streaming.id = 'chat-streaming';
    streaming.name = 'Streaming';
    streaming.history.push({ role: 'user', content: 'hi' });

    setSessionStateForTests({
      version: 2,
      activeId: streaming.id,
      sidebarCollapsed: false,
      chats: [streaming],
    });

    appState.setStreaming(true, streaming.id);
    setSidebarStreamPhase('generating', streaming.id);

    let remounted = false;
    registerStreamDomRemount(streaming.id, (row) => {
      remounted = true;
      assert.ok(row.streamStatus);
    });

    renderChatFromHistory(streaming);
    // renderChatFromHistory lazy-imports remountStreamDomForChat to avoid a circular module graph.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(remounted, 'remount listener should run during history re-render');

    const label = document
      .getElementById('chatArea')
      ?.querySelector('.stream-status__label');
    assert.equal(label?.textContent, STREAM_LABEL_GENERATING);
  });

  test('remountStreamDomForChat restores Thinking… phase when applicable', () => {
    setupDom();
    const streaming = createEmptyChatObject('');
    streaming.id = 'chat-streaming';
    streaming.history.push({ role: 'user', content: 'hi' });

    setSessionStateForTests({
      version: 2,
      activeId: streaming.id,
      sidebarCollapsed: false,
      chats: [streaming],
    });

    appState.setStreaming(true, streaming.id);
    setSidebarStreamPhase('thinking', streaming.id);

    registerStreamDomRemount(streaming.id, () => {});

    remountStreamDomForChat(streaming.id);

    const label = document
      .getElementById('chatArea')
      ?.querySelector('.stream-status__label');
    assert.equal(label?.textContent, STREAM_LABEL_THINKING);
  });

  test('double remount leaves a single Generating response… row', () => {
    setupDom();
    const streaming = createEmptyChatObject('');
    streaming.id = 'chat-streaming';
    streaming.history.push({ role: 'user', content: 'hi' });

    setSessionStateForTests({
      version: 2,
      activeId: streaming.id,
      sidebarCollapsed: false,
      chats: [streaming],
    });

    appState.setStreaming(true, streaming.id);
    setSidebarStreamPhase('generating', streaming.id);
    registerStreamDomRemount(streaming.id, () => {});

    remountStreamDomForChat(streaming.id);
    remountStreamDomForChat(streaming.id);

    const area = document.getElementById('chatArea');
    assert.equal(area?.querySelectorAll('.stream-status').length, 1);
    assert.equal(area?.querySelectorAll('.msg--awaiting-prose').length, 1);
    assert.equal(
      area?.querySelector('.stream-status__label')?.textContent,
      STREAM_LABEL_GENERATING,
    );
  });
});
