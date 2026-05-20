/**
 * Board-only streaming: appendBubble does not mutate #chatArea in board view.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { appendBubble } = await import('../../src/ui/messages.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
}

describe('orchestrate board streaming guards', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('appendBubble does not append to chatArea when viewMode is board', () => {
    setupDom();
    const chat = createEmptyChatObject('');
    chat.id = FIXED_CHAT_ID;
    chat.modeId = 'orchestrate';
    chat.viewMode = 'board';
    chat.orchestratePlanPath = 'documentation/plans/x.md';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const before = document.getElementById('chatArea').childElementCount;
    appendBubble('assistant', 'Hello from stream');
    const after = document.getElementById('chatArea').childElementCount;
    assert.equal(after, before);
  });
});
