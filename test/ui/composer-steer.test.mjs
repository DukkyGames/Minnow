import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { handleComposerPrimaryAction } = await import('../../src/ui/composer-send.ts');

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STEER_TEXT = 'Use pnpm not npm';

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  const btn = document.createElement('button');
  btn.id = 'sendBtn';
  btn.type = 'button';
  document.body.appendChild(btn);

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);

  return { btn, input };
}

function seedStreamingChat() {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  appState.setStreaming(true, chat.id);
  return chat;
}

describe('composer queue vs stop', () => {
  afterEach(() => {
    appState.setStreaming(false);
    setSessionStateForTests(null);
    appState.setChatAbort(FIXED_CHAT_ID, null);
  });

  test('streaming with text enqueues follow-up without abort', () => {
    const chat = seedStreamingChat();
    const { input } = setupDom();
    input.value = STEER_TEXT;

    let aborted = false;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    appState.setChatAbort(chat.id, controller);

    handleComposerPrimaryAction();

    assert.equal(aborted, false);
    assert.equal(chat.pendingMessageQueue?.length, 1);
    assert.equal(chat.pendingMessageQueue?.[0]?.text, STEER_TEXT);
    assert.equal(input.value, '');
  });

  test('streaming with empty input aborts via stopGeneration', () => {
    const chat = seedStreamingChat();
    setupDom();

    let aborted = false;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    appState.setChatAbort(chat.id, controller);

    handleComposerPrimaryAction();

    assert.equal(aborted, true);
  });
});
