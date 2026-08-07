import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setDesktopStateForTests, resetDesktopStateForTests } = await import(
  '../helpers/legacy-desktop-state.ts'
);
const { resetInstancesForTests } = await import('../../src/os/instances.ts');
const { renderChatFromHistory } = await import('../../src/ui/messages.ts');
const {
  bindDesktopChatTranscriptScroll,
  initChatScroll,
  isChatScrollPinned,
  scrollChatToBottom,
} = await import('../../src/ui/chat-scroll.ts');

function setupDesktopTranscriptDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 0;
  };

  resetInstancesForTests();
  setDesktopStateForTests('chatActive');

  const transcript = document.createElement('div');
  transcript.className = 'mn-os-chat-transcript';
  Object.defineProperty(transcript, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(transcript, 'clientHeight', { value: 400, configurable: true });
  let scrollTop = 200;
  Object.defineProperty(transcript, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => {
      scrollTop = v;
    },
    configurable: true,
  });

  const col = document.createElement('div');
  col.id = 'desktopChatCol';
  transcript.appendChild(col);
  document.body.appendChild(transcript);

  const chip = document.createElement('button');
  chip.id = 'chatJumpLatest';
  chip.className = 'chat-jump-latest hidden';
  document.body.appendChild(chip);

  initChatScroll();
  bindDesktopChatTranscriptScroll();
  transcript.dispatchEvent(new window.Event('scroll'));

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

  return { window, transcript, chat, getScrollTop: () => scrollTop };
}

describe('renderChatFromHistory scroll preservation', { concurrency: false }, () => {
  afterEach(() => {
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    resetInstancesForTests();
  });

  test('desktop history rebuild preserves read position when scrolled up', () => {
    const { transcript, chat, getScrollTop } = setupDesktopTranscriptDom();
    const beforeDistance =
      transcript.scrollHeight - getScrollTop() - transcript.clientHeight;
    assert.equal(isChatScrollPinned(), false);

    renderChatFromHistory(chat, '#desktopChatCol');

    const afterDistance =
      transcript.scrollHeight - getScrollTop() - transcript.clientHeight;
    assert.equal(afterDistance, beforeDistance);
    assert.equal(isChatScrollPinned(), false);
  });

  test('desktop history rebuild follows tail when pinned near bottom', () => {
    const { transcript, chat, getScrollTop } = setupDesktopTranscriptDom();
    scrollChatToBottom();
    assert.equal(isChatScrollPinned(), true);

    renderChatFromHistory(chat, '#desktopChatCol');

    assert.equal(getScrollTop(), transcript.scrollHeight);
    assert.equal(isChatScrollPinned(), true);
  });
});
