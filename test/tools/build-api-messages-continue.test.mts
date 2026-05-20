/**
 * buildApiMessages: reload resume injects checkpoint assistant before continue user line.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildApiMessages } from '../../src/tools/loop.ts';
import { CONTINUE_INTERRUPTED_INSTRUCTION } from '../../src/state/pending-turn-shape.ts';
import type { Chat, PendingTurn } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STARTED = 1710000000000;

function baseChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Test',
    workspacePath: '',
    modelId: 'm1',
    history: [{ role: 'user', content: 'Hello' }],
    lastStats: null,
    modelInfo: {},
    updatedAt: STARTED,
    ...overrides,
  };
}

describe('buildApiMessages continue from pendingTurn', () => {
  test('injects assistant checkpoint then ephemeral continue user message', () => {
    const chat = baseChat();
    const pending: PendingTurn = {
      role: 'assistant',
      content: 'Partial answer so far',
      startedAt: STARTED,
    };
    const messages = buildApiMessages(chat, '', {
      ephemeralContinueInstruction: CONTINUE_INTERRUPTED_INSTRUCTION,
      pendingTurnResume: pending,
    });
    const nonSystem = messages.filter((m) => m.role !== 'system');
    assert.equal(nonSystem.length, 3);
    assert.equal(nonSystem[0]?.role, 'user');
    assert.equal(nonSystem[1]?.role, 'assistant');
    assert.equal(nonSystem[1]?.content, 'Partial answer so far');
    assert.equal(nonSystem[2]?.role, 'user');
    assert.equal(nonSystem[2]?.content, CONTINUE_INTERRUPTED_INSTRUCTION);
  });

  test('skips inject when last history assistant matches pending prose', () => {
    const chat = baseChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Same partial' },
      ],
    });
    const pending: PendingTurn = {
      role: 'assistant',
      content: 'Same partial',
      startedAt: STARTED,
    };
    const messages = buildApiMessages(chat, '', {
      ephemeralContinueInstruction: CONTINUE_INTERRUPTED_INSTRUCTION,
      pendingTurnResume: pending,
    });
    const nonSystem = messages.filter((m) => m.role !== 'system');
    assert.equal(nonSystem.length, 3);
    assert.equal(nonSystem[2]?.role, 'user');
    assert.equal(nonSystem[2]?.content, CONTINUE_INTERRUPTED_INSTRUCTION);
  });

  test('injects after trailing tool rows when checkpoint differs', () => {
    const chat = baseChat({
      history: [
        { role: 'user', content: 'Run tool' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'noop', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      ],
    });
    const pending: PendingTurn = {
      role: 'assistant',
      content: 'After tool prose',
      startedAt: STARTED,
    };
    const messages = buildApiMessages(chat, '', {
      ephemeralContinueInstruction: CONTINUE_INTERRUPTED_INSTRUCTION,
      pendingTurnResume: pending,
    });
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const last = nonSystem[nonSystem.length - 1];
    const secondLast = nonSystem[nonSystem.length - 2];
    assert.equal(secondLast?.role, 'assistant');
    assert.equal(secondLast?.content, 'After tool prose');
    assert.equal(last?.role, 'user');
    assert.equal(last?.content, CONTINUE_INTERRUPTED_INSTRUCTION);
  });
});
