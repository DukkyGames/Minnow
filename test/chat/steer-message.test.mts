import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  clearPendingSteer,
  consumePendingSteer,
  enqueueSteerMessage,
  formatSteerHistoryContent,
} from '../../src/chat/steer-message.ts';
import {
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
  createEmptyChatObject,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STEER_TEXT = 'Use pnpm not npm';

function seedChat(): ReturnType<typeof createEmptyChatObject> {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

describe('steer-message helpers', () => {
  beforeEach(() => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
  });

  afterEach(() => {
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('formatSteerHistoryContent trims whitespace', () => {
    assert.equal(formatSteerHistoryContent(`  ${STEER_TEXT}  `), STEER_TEXT);
  });

  test('consumePendingSteer no-op when pending empty', () => {
    const chat = seedChat();
    const result = consumePendingSteer(chat, { renderDom: false });
    assert.equal(result.consumed, false);
    assert.equal(chat.history.length, 0);
  });

  test('consumePendingSteer pushes user row with steer flag and clears pending', () => {
    const chat = seedChat();
    chat.pendingSteerMessage = STEER_TEXT;
    const result = consumePendingSteer(chat, { renderDom: false });
    assert.equal(result.consumed, true);
    assert.equal(result.content, STEER_TEXT);
    assert.equal(chat.history.length, 1);
    assert.equal(chat.history[0]?.role, 'user');
    assert.equal((chat.history[0] as { steer?: boolean }).steer, true);
    assert.equal(chat.pendingSteerMessage, undefined);
  });

  test('enqueueSteerMessage last write wins', () => {
    const chat = seedChat();
    assert.equal(enqueueSteerMessage(chat, 'first'), true);
    assert.equal(enqueueSteerMessage(chat, STEER_TEXT), true);
    assert.equal(chat.pendingSteerMessage, STEER_TEXT);
  });

  test('clearPendingSteer removes queued text', () => {
    const chat = seedChat();
    chat.pendingSteerMessage = STEER_TEXT;
    clearPendingSteer(chat);
    assert.equal(chat.pendingSteerMessage, undefined);
  });
});
