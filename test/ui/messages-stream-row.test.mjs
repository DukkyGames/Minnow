import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const {
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
} = await import('../../src/ui/messages.ts');

function setupChatDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML =
    '<main id="chatArea"><div id="emptyState">Empty</div></main>';
  return window;
}

describe('messages stream row', { concurrency: false }, () => {
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
