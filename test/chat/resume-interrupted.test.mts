/**
 * Interrupted-work marker for the boot resume gate (Quit Minnow / crash mid-turn).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  chatLooksInFlightForShutdown,
  clearChatResumeInterrupted,
  isChatResumeInterrupted,
  markChatResumeInterrupted,
  markInterruptedChatsForShutdown,
} from '../../src/chat/resume-interrupted.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, SessionState } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Test',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [],
    historyLoaded: true,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  setSessionStateForTests(null);
});

describe('resume-interrupted', () => {
  test('mark and clear toggle the persisted flag', () => {
    const chat = makeChat();
    assert.equal(isChatResumeInterrupted(chat), false);

    markChatResumeInterrupted(chat);
    assert.equal(chat.resumeInterrupted, true);
    assert.equal(isChatResumeInterrupted(chat), true);

    clearChatResumeInterrupted(chat);
    assert.equal(chat.resumeInterrupted, undefined);
  });

  test('in-flight detection covers generation id and the interrupt stamp', () => {
    assert.equal(
      chatLooksInFlightForShutdown(makeChat({ currentGenerationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })),
      true,
    );
    assert.equal(chatLooksInFlightForShutdown(makeChat({ resumeInterrupted: true })), true);
    assert.equal(chatLooksInFlightForShutdown(makeChat()), false);
  });

  test('shutdown stamp sets resumeInterrupted on chats with a generation id', () => {
    const chat = makeChat({
      currentGenerationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    const state: SessionState = {
      version: 5,
      activeId: CHAT_ID,
      chats: [chat],
      groups: [],
    };
    setSessionStateForTests(state);

    markInterruptedChatsForShutdown();

    assert.equal(chat.resumeInterrupted, true);
  });
});
