import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { consumePendingSteer } from '../../src/chat/steer-message.ts';
import {
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
  createEmptyChatObject,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STEER_TEXT = 'Use pnpm not npm';

describe('steer at tool-loop boundary', () => {
  afterEach(() => {
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('consumed steer is in history before the next model round', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = FIXED_CHAT_ID;
    chat.history.push({
      role: 'assistant',
      content: 'Listing files…',
      tool_calls: [
        {
          id: 'tc-1',
          type: 'function',
          function: { name: 'list_dir', arguments: '{}' },
        },
      ],
    });
    chat.pendingSteerMessage = STEER_TEXT;
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const result = consumePendingSteer(chat, { renderDom: false });

    assert.equal(result.consumed, true);
    assert.equal(chat.history.length, 2);
    assert.equal(chat.history[1]?.role, 'user');
    assert.equal(chat.history[1]?.content, STEER_TEXT);
    assert.equal((chat.history[1] as { steer?: boolean }).steer, true);
    assert.equal(chat.pendingSteerMessage, undefined);
  });

  test('one turn: consume at the boundary does not mint a second user send', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = FIXED_CHAT_ID;
    chat.history.push({ role: 'user', content: 'What time is it?' });
    chat.history.push({
      role: 'assistant',
      content: 'Listing files…',
      tool_calls: [
        {
          id: 'tc-1',
          type: 'function',
          function: { name: 'list_dir', arguments: '{}' },
        },
      ],
    });
    chat.pendingSteerMessage = STEER_TEXT;
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    consumePendingSteer(chat, { renderDom: false });

    const userRows = chat.history.filter((m) => m.role === 'user');
    assert.equal(userRows.length, 2, 'original send plus in-turn steer');
    assert.equal((userRows[1] as { steer?: boolean }).steer, true);
    assert.equal(chat.pendingSteerMessage, undefined);
  });
});
