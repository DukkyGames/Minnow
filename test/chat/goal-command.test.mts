import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { handleGoalCommand } from '../../src/chat/goal/command.ts';
import {
  clearActiveGoal,
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  getActiveGoal,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const CONDITION = 'all unit tests pass';

function seedChat() {
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

describe('handleGoalCommand', () => {
  afterEach(() => {
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('returns null for unrelated text', () => {
    const chat = seedChat();
    const status: string[] = [];
    assert.equal(
      handleGoalCommand(chat, 'hello', (_level, message) => {
        status.push(message);
      }),
      null,
    );
    assert.equal(status.length, 0);
  });

  test('set stores goal and returns set', () => {
    const chat = seedChat();
    assert.equal(
      handleGoalCommand(chat, `/goal ${CONDITION}`, () => undefined),
      'set',
    );
    assert.equal(getActiveGoal(chat)?.conditionText, CONDITION);
    assert.equal(getActiveGoal(chat)?.turnCount, 0);
  });

  test('status is handled without mutating goal', () => {
    const chat = seedChat();
    handleGoalCommand(chat, `/goal ${CONDITION}`, () => undefined);
    const messages: string[] = [];
    assert.equal(
      handleGoalCommand(chat, '/goal', (_level, message) => {
        messages.push(message);
      }),
      'handled',
    );
    assert.match(messages[0] ?? '', /Goal:/);
    assert.equal(getActiveGoal(chat)?.conditionText, CONDITION);
  });

  test('clear removes goal', () => {
    const chat = seedChat();
    handleGoalCommand(chat, `/goal ${CONDITION}`, () => undefined);
    assert.equal(handleGoalCommand(chat, '/goal clear', () => undefined), 'handled');
    assert.equal(getActiveGoal(chat), undefined);
  });
});
