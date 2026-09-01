/**
 * Continue after a failure must resend the visible transcript (MIN-666 / MIN-641).
 * Clear is covered in history.test.mts; this file checks the outbound payload.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildApiMessages } from '../../src/chat/build-api-messages.ts';
import {
  CONTINUE_AFTER_FAILURE_INSTRUCTION,
  resolveFailedTurnContinueInstruction,
} from '../../src/tools/turn-continuation.ts';
import { sliceHistoryAtTurn } from '../../src/chat/history-truncate-core.ts';
import type { Chat, Message } from '../../src/types.ts';

const HISTORY: Message[] = [
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'Hi there.' },
  { role: 'user', content: 'now do X' },
  { role: 'assistant', content: 'Partial answer befo', failed: true },
];

function chatWith(history: Message[]): Chat {
  return {
    id: 'chat-failed-continue',
    name: 'Failed continue',
    workspacePath: '/tmp/ws',
    modelId: 'test-model',
    modeId: 'general',
    history: history.map((m) => ({ ...m })),
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

describe('failed-turn Continue outbound (MIN-666)', () => {
  test('injects the continue instruction only when history does not end on a user row', () => {
    assert.equal(
      resolveFailedTurnContinueInstruction(HISTORY),
      CONTINUE_AFTER_FAILURE_INSTRUCTION,
    );
    assert.equal(
      resolveFailedTurnContinueInstruction(HISTORY.slice(0, 3)),
      undefined,
    );
  });

  test('Continue resends earlier turns and the failed partial', () => {
    const instruction = resolveFailedTurnContinueInstruction(HISTORY);
    const messages = buildApiMessages(chatWith(HISTORY), 'sys', {
      modelId: 'test-model',
      attachments: [],
      ephemeralContinueInstruction: instruction,
    });
    const roles = messages.filter((m) => m.role !== 'system').map((m) => {
      const content = typeof m.content === 'string' ? m.content : '';
      return { role: m.role, content };
    });
    assert.deepEqual(roles, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there.' },
      { role: 'user', content: 'now do X' },
      { role: 'assistant', content: 'Partial answer befo' },
      { role: 'user', content: CONTINUE_AFTER_FAILURE_INSTRUCTION },
    ]);
  });

  test('the old rewind-and-retry path would have dropped the failed partial', () => {
    const rewind = sliceHistoryAtTurn(HISTORY, 2, 'inclusive');
    assert.equal(rewind.length, 3);
    assert.equal(rewind.at(-1)?.role, 'user');
    assert.equal(
      rewind.some((m) => m.role === 'assistant' && 'failed' in m && m.failed),
      false,
    );
  });

  test('Continue does not wipe earlier successful turns from the payload', () => {
    const messages = buildApiMessages(chatWith(HISTORY), 'sys', {
      modelId: 'test-model',
      attachments: [],
      ephemeralContinueInstruction: CONTINUE_AFTER_FAILURE_INSTRUCTION,
    });
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    assert.ok(contents.includes('hello'));
    assert.ok(contents.includes('Hi there.'));
    assert.ok(contents.includes('now do X'));
  });
});
