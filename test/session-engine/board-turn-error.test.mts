/**
 * Board turn error contract (MIN-354 landing).
 *
 * The engine loop deliberately writes no `Error:` history row — the main-chat
 * path adds exactly one in server/session/commands.js, and board task chats are
 * surfaced by handleTaskChatLaunchFailure instead (parity with renderer
 * runChatTurn, which never wrote a row either). This pins that split so a future
 * change cannot silently swallow a board task failure.
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, mock, test } from 'node:test';
import type { Chat } from '../../src/types.ts';

/** Engine state the mocked engine-api mutates in place. */
let state: { chats: Chat[] };
let turnError: Error | null = null;

function makeChat(): Chat {
  return {
    id: 'task-chat',
    title: 'Task',
    history: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Chat;
}

mock.module('../../server/session/engine-api.js', {
  namedExports: {
    beginEngineTurn: () => new AbortController(),
    endEngineTurn: () => {},
    async mutateEngineState(mutator: (s: unknown) => void) {
      mutator(state);
      return 1;
    },
    getEngineSessionState: () => state,
  },
});

mock.module('../../server/session/commands.js', {
  namedExports: {
    findChatInState: (s: { chats: Chat[] } | null, id: string) =>
      s?.chats.find((c) => c.id === id) ?? null,
  },
});

mock.module('../../server/session/loop-loader.js', {
  namedExports: {
    async runEngineMainChatTurn() {
      if (turnError) throw turnError;
    },
  },
});

const { runBoardEngineChatTurn } = await import(
  '../../src/session-engine/board-turn-runner.ts'
);
const { subscribeChatStreamEnd } = await import('../../src/session-engine/stream-bus.ts');

function baseOptions(chat: Chat) {
  return {
    chat,
    pushUser: true,
    rawText: 'do the task',
    userText: 'do the task',
    displayText: 'do the task',
    historyContent: 'do the task',
    skillId: null,
    validAttachments: [],
  };
}

describe('runBoardEngineChatTurn error contract', () => {
  beforeEach(() => {
    state = { chats: [makeChat()] };
    turnError = null;
  });

  test('rejects to the caller and writes no Error history row', async () => {
    turnError = new Error('provider exploded');
    const endedChatIds: string[] = [];
    const unsubscribe = subscribeChatStreamEnd((id: string) => endedChatIds.push(id));

    try {
      await assert.rejects(
        () => runBoardEngineChatTurn(baseOptions(state.chats[0]!)),
        /provider exploded/,
        'board launcher must see the failure (handleTaskChatLaunchFailure surfaces it)',
      );
    } finally {
      unsubscribe();
    }

    const chat = state.chats[0]!;
    const errorRows = chat.history.filter(
      (m) => m.role === 'assistant' && String(m.content ?? '').startsWith('Error:'),
    );
    assert.equal(errorRows.length, 0, 'engine loop must not write an Error row');
    // The user prompt row still lands, and the turn is released.
    assert.equal(chat.history.filter((m) => m.role === 'user').length, 1);
    assert.equal(chat.engineTurnActive, false);
    assert.equal(chat.currentGenerationId, undefined);
    // Stream-end must still fire or the board drain stalls forever.
    assert.deepEqual(endedChatIds, ['task-chat']);
  });

  test('successful turn also fires stream-end exactly once', async () => {
    const endedChatIds: string[] = [];
    const unsubscribe = subscribeChatStreamEnd((id: string) => endedChatIds.push(id));
    try {
      await runBoardEngineChatTurn(baseOptions(state.chats[0]!));
    } finally {
      unsubscribe();
    }
    assert.deepEqual(endedChatIds, ['task-chat']);
    assert.equal(state.chats[0]!.engineTurnActive, false);
  });
});
