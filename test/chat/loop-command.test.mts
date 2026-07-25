import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { handleLoopCommand } from '../../src/chat/loop/command.ts';
import { handleGoalCommand } from '../../src/chat/goal/command.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  getActiveGoal,
  getActiveLoops,
  hasActiveLoops,
  setActiveGoal,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '33333333-3333-3333-3333-333333333333';
const FIXED_NOW = 1_700_000_000_000;

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

describe('handleLoopCommand', () => {
  afterEach(() => {
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('returns null for unrelated text', () => {
    const chat = seedChat();
    const status: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        'hello',
        (_level, message) => {
          status.push(message);
        },
        FIXED_NOW,
      ),
      null,
    );
    assert.equal(status.length, 0);
  });

  test('arms interval loop and returns handled', () => {
    const chat = seedChat();
    const messages: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        '/loop 5m check deploy',
        (_level, message) => {
          messages.push(message);
        },
        FIXED_NOW,
      ),
      'handled',
    );
    const loops = getActiveLoops(chat);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].id, 1);
    assert.equal(loops[0].kind, 'interval');
    assert.equal(loops[0].intervalMs, 5 * 60_000);
    assert.equal(loops[0].promptText, 'check deploy');
    assert.equal(loops[0].dueAt, FIXED_NOW);
    assert.match(messages[0] ?? '', /Loop #1 armed/);
  });

  test('list and stop subcommands are rejected for chat UI', () => {
    const chat = seedChat();
    handleLoopCommand(chat, '/loop 1m a', () => undefined, FIXED_NOW);

    const listMessages: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        '/loop list',
        (_level, message) => {
          listMessages.push(message);
        },
        FIXED_NOW,
      ),
      'handled',
    );
    assert.match(listMessages[0] ?? '', /loop panel in chat/);
    assert.equal(getActiveLoops(chat).length, 1);

    const stopMessages: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        '/loop stop',
        (_level, message) => {
          stopMessages.push(message);
        },
        FIXED_NOW,
      ),
      'handled',
    );
    assert.match(stopMessages[0] ?? '', /loop panel in chat/);
    assert.equal(getActiveLoops(chat).length, 1);
  });

  test('rejects nested /loop or /goal prompt', () => {
    const chat = seedChat();
    const messages: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        '/loop 5m /goal finish',
        (_level, message) => {
          messages.push(message);
        },
        FIXED_NOW,
      ),
      'handled',
    );
    assert.equal(hasActiveLoops(chat), false);
    assert.match(messages[0] ?? '', /cannot start another/);
  });

  test('goal exclusivity both directions', () => {
    const chat = seedChat();
    setActiveGoal(chat, 'all tests pass');
    const loopMessages: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        '/loop 1m hi',
        (_level, message) => {
          loopMessages.push(message);
        },
        FIXED_NOW,
      ),
      'handled',
    );
    assert.equal(hasActiveLoops(chat), false);
    assert.match(loopMessages[0] ?? '', /Stop the active goal first/);

    // Clear goal, arm loop, then goal set should fail
    handleGoalCommand(chat, '/goal clear', () => undefined);
    handleLoopCommand(chat, '/loop 1m hi', () => undefined, FIXED_NOW);
    assert.equal(hasActiveLoops(chat), true);

    const goalMessages: string[] = [];
    assert.equal(
      handleGoalCommand(chat, '/goal all green', (_level, message) => {
        goalMessages.push(message);
      }),
      'handled',
    );
    assert.equal(getActiveGoal(chat), undefined);
    assert.match(goalMessages[0] ?? '', /Stop active loops first/);
  });

  test('interval without prompt errors', () => {
    const chat = seedChat();
    const messages: string[] = [];
    assert.equal(
      handleLoopCommand(
        chat,
        '/loop 5m',
        (_level, message) => {
          messages.push(message);
        },
        FIXED_NOW,
      ),
      'handled',
    );
    assert.equal(hasActiveLoops(chat), false);
    assert.match(messages[0] ?? '', /Add a prompt after the interval/);
  });
});
