import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const {
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
} = await import('../../src/ui/messages.ts');
const {
  initChatScroll,
  isChatScrollPinned,
  scrollChatToBottom,
} = await import('../../src/ui/chat-scroll.ts');

function setupChatDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML =
    '<main id="chatArea"><div id="emptyState">Empty</div></main>' +
    '<button id="chatJumpLatest" class="chat-jump-latest hidden"></button>';
  globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 0;
  };
  initChatScroll();
  const chat = createEmptyChatObject('');
  chat.id = 'chat-stream-row';
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return window;
}

describe('messages stream row', { concurrency: false }, () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

test('appendStreamingAssistantRow inserts stream-status before awaiting bubble', () => {
  setupChatDom();
  const { wrap, bubble, streamStatus } = appendStreamingAssistantRow();

  const status = wrap.querySelector('.stream-status');
  assert.ok(status);
  assert.equal(status?.nextElementSibling, bubble);
  assert.ok(wrap.classList.contains('msg--awaiting-prose'));
  assert.ok(bubble.classList.contains('msg-bubble--awaiting'));

  streamStatus.dispose();
});

test('appendStreamingAssistantRow does not force scroll when user scrolled up', () => {
  const win = setupChatDom();
  const area = document.getElementById('chatArea');
  Object.defineProperty(area, 'scrollHeight', { value: 1200, configurable: true });
  Object.defineProperty(area, 'clientHeight', { value: 400, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(area, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => {
      scrollTop = v;
    },
    configurable: true,
  });

  scrollChatToBottom();
  assert.equal(isChatScrollPinned(), true);

  scrollTop = 0;
  area.dispatchEvent(new win.Event('scroll'));
  assert.equal(isChatScrollPinned(), false);

  const before = scrollTop;
  const { streamStatus } = appendStreamingAssistantRow();
  assert.equal(scrollTop, before, 'new stream shell must not snap scroll when detached');
  assert.equal(isChatScrollPinned(), false);

  streamStatus.dispose();
});

test('appendStreamingAssistantRow follows tail when pinned near bottom', () => {
  setupChatDom();
  const area = document.getElementById('chatArea');
  Object.defineProperty(area, 'scrollHeight', { value: 1200, configurable: true });
  Object.defineProperty(area, 'clientHeight', { value: 400, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(area, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => {
      scrollTop = v;
    },
    configurable: true,
  });

  scrollChatToBottom();
  const { streamStatus } = appendStreamingAssistantRow();
  assert.equal(scrollTop, area.scrollHeight);

  streamStatus.dispose();
});

test('revealAssistantProseBubble removes awaiting state and hides status', () => {
  setupChatDom();
  const { wrap, bubble, streamStatus } = appendStreamingAssistantRow();

  revealAssistantProseBubble(wrap, bubble, streamStatus);

  assert.ok(!wrap.classList.contains('msg--awaiting-prose'));
  assert.ok(!bubble.classList.contains('msg-bubble--awaiting'));
  const status = wrap.querySelector('.stream-status');
  assert.ok(status?.classList.contains('hidden'));
  assert.equal(status?.getAttribute('aria-busy'), 'false');

  streamStatus.dispose();
});
});
