import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { resetDesktopStateForTests, setDesktopStateForTests } = await import(
  '../../src/os/desktop-state.ts'
);

let activeWindow = null;

function setupDesktopDom() {
  activeWindow?.close();
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  const codeArea = document.createElement('div');
  codeArea.id = 'chatArea';
  document.body.appendChild(codeArea);

  const desktopCol = document.createElement('div');
  desktopCol.id = 'desktopChatCol';
  document.body.appendChild(desktopCol);

  for (const id of ['modelSelect', 'sendBtn', 'msgInput']) {
    const el =
      id === 'modelSelect'
        ? document.createElement('select')
        : id === 'msgInput'
          ? document.createElement('textarea')
          : document.createElement('button');
    el.id = id;
    document.body.appendChild(el);
  }

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
}

function makeToolCallHistoryChat() {
  const chat = createEmptyChatObject('');
  chat.id = 'chat-desktop-sync';
  chat.history.push({ role: 'user', content: 'list files' });
  chat.history.push({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'list_directory', arguments: '{"path":"."}' },
      },
    ],
  });
  chat.history.push({
    role: 'tool',
    tool_call_id: 'call-1',
    content: 'ok',
  });
  return chat;
}

describe('foreground transcript paint', { concurrency: false }, () => {
  afterEach(() => {
    resetDesktopStateForTests();
    setSessionStateForTests(null);
    activeWindow?.close();
    activeWindow = null;
  });

  test('renderChatInForegroundShell paints tool calls into desktopChatCol', async () => {
    setupDesktopDom();
    setDesktopStateForTests('chatActive');

    const chat = makeToolCallHistoryChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const { renderChatInForegroundShell } = await import('../../src/ui/messages.ts');
    renderChatInForegroundShell(chat);
    await new Promise((resolve) => setImmediate(resolve));

    const desktop = document.getElementById('desktopChatCol');
    const code = document.getElementById('chatArea');
    assert.equal(desktop?.querySelectorAll('.tool-call-msg').length, 1);
    assert.equal(code?.querySelectorAll('.tool-call-msg').length, 0);
  });

  test('renderDesktopChatMessages paints tool calls into desktopChatCol', async () => {
    setupDesktopDom();
    setDesktopStateForTests('chatActive');

    const chat = makeToolCallHistoryChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const { renderDesktopChatMessages } = await import('../../src/os/desktop-chat.ts');
    renderDesktopChatMessages();

    const desktop = document.getElementById('desktopChatCol');
    assert.equal(desktop?.querySelectorAll('.tool-call-msg').length, 1);
  });
});
