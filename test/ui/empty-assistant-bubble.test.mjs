/**
 * MIN-11: tool-only / empty prose turns must not leave visible empty assistant bubbles.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const {
  appendStreamingAssistantRow,
  assistantProseHasVisibleContent,
  removeOrphanStreamingRow,
  revealAssistantProseBubble,
} = await import('../../src/ui/messages.ts');

function setupChatDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML =
    '<main id="chatArea"><div id="emptyState">Empty</div></main>';
  const chat = createEmptyChatObject('');
  chat.id = 'chat-empty-bubble';
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return window;
}

function countEmptyAssistantBubbles() {
  const area = document.getElementById('chatArea');
  const assistants = area.querySelectorAll('.msg.assistant');
  let empty = 0;
  for (const msg of assistants) {
    const bubble = msg.querySelector('.msg-bubble');
    if (!bubble) continue;
    const text = (bubble.textContent || '').trim();
    const hasToolCard = msg.classList.contains('tool-call') || msg.nextElementSibling?.classList?.contains('tool-call');
    if (!text && !hasToolCard) empty += 1;
  }
  return { assistants: assistants.length, empty };
}

describe('empty assistant bubble guards', { concurrency: false }, () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('assistantProseHasVisibleContent rejects whitespace-only prose', () => {
    assert.equal(assistantProseHasVisibleContent('   \n'), false);
    assert.equal(assistantProseHasVisibleContent('hi'), true);
    assert.equal(assistantProseHasVisibleContent('', true), true);
  });

  test('removeOrphanStreamingRow drops awaiting shell (tool-only turn simulation)', () => {
    setupChatDom();
    const { wrap, bubble, streamStatus } = appendStreamingAssistantRow();
    assert.equal(document.getElementById('chatArea').querySelectorAll('.msg.assistant').length, 1);

    removeOrphanStreamingRow(wrap, streamStatus);

    const counts = countEmptyAssistantBubbles();
    assert.equal(counts.assistants, 0);
    assert.equal(counts.empty, 0);
  });

  test('reveal without content leaves empty bubble; removeOrphan clears it', () => {
    setupChatDom();
    const { wrap, bubble, streamStatus } = appendStreamingAssistantRow();
    revealAssistantProseBubble(wrap, bubble, streamStatus);

    let counts = countEmptyAssistantBubbles();
    assert.equal(counts.empty, 1);

    removeOrphanStreamingRow(wrap, streamStatus);
    counts = countEmptyAssistantBubbles();
    assert.equal(counts.assistants, 0);
    assert.equal(counts.empty, 0);
  });
});
