import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { resetInstancesForTests } = await import('../../src/os/instances.ts');
const { renderChatFromHistory } = await import('../../src/ui/messages.ts');
const {
  initChatScroll,
  isChatScrollPinned,
  scrollChatToBottom,
} = await import('../../src/ui/chat-scroll.ts');

function setupCodeTranscriptDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 0;
  };

  resetInstancesForTests();

  const chatArea = document.createElement('div');
  chatArea.id = 'chatArea';
  Object.defineProperty(chatArea, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(chatArea, 'clientHeight', { value: 400, configurable: true });
  let scrollTop = 200;
  Object.defineProperty(chatArea, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => {
      scrollTop = v;
    },
    configurable: true,
  });
  document.body.appendChild(chatArea);

  const chip = document.createElement('button');
  chip.id = 'chatJumpLatest';
  chip.className = 'chat-jump-latest hidden';
  document.body.appendChild(chip);

  initChatScroll();
  chatArea.dispatchEvent(new window.Event('scroll'));

  const chat = createEmptyChatObject('');
  chat.id = 'history-scroll-chat';
  chat.history = [
    { role: 'user', content: 'Earlier question' },
    { role: 'user', content: 'Middle question' },
    { role: 'user', content: 'Follow-up question' },
  ];
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });

  return { window, chatArea, chat, getScrollTop: () => scrollTop };
}

describe('renderChatFromHistory scroll preservation', { concurrency: false }, () => {
  afterEach(() => {
    setSessionStateForTests(null);
    resetInstancesForTests();
  });

  test('history rebuild preserves read position when scrolled up', () => {
    const { chatArea, chat, getScrollTop } = setupCodeTranscriptDom();
    const beforeDistance =
      chatArea.scrollHeight - getScrollTop() - chatArea.clientHeight;
    assert.equal(isChatScrollPinned(), false);

    renderChatFromHistory(chat);

    const afterDistance =
      chatArea.scrollHeight - getScrollTop() - chatArea.clientHeight;
    assert.equal(afterDistance, beforeDistance);
    assert.equal(isChatScrollPinned(), false);
  });

  test('history rebuild follows tail when pinned near bottom', () => {
    const { chatArea, chat, getScrollTop } = setupCodeTranscriptDom();
    scrollChatToBottom();
    assert.equal(isChatScrollPinned(), true);

    renderChatFromHistory(chat);

    assert.equal(getScrollTop(), chatArea.scrollHeight);
    assert.equal(isChatScrollPinned(), true);
  });
});
