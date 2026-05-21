/**
 * Obsolete pendingTurn detection (finished reply already in history).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearStalePendingTurn,
  isPendingTurnObsolete,
  shouldOfferRecovery,
} from '../../src/state/pending-turn-shape.ts';
import type { Chat } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_STARTED = 1710000000000;

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Test',
    workspacePath: '',
    modelId: 'm1',
    history: [{ role: 'user', content: 'Hi' }],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_STARTED,
    ...overrides,
  };
}

const STALE_PENDING = {
  role: 'assistant' as const,
  content: 'partial checkpoint',
  startedAt: FIXED_STARTED,
};

describe('isPendingTurnObsolete', () => {
  test('true when history ends with assistant prose', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'All done.' },
      ],
      pendingTurn: STALE_PENDING,
    });
    assert.equal(isPendingTurnObsolete(chat), true);
  });

  test('false when last row is user (interrupted, no history assistant)', () => {
    const chat = makeChat({ pendingTurn: STALE_PENDING });
    assert.equal(isPendingTurnObsolete(chat), false);
  });

  test('false when checkpoint was user-stopped', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Partial in history' },
      ],
      pendingTurn: { ...STALE_PENDING, stopped: true },
    });
    assert.equal(isPendingTurnObsolete(chat), false);
  });

  test('false when history ends with tool tail', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Read file' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tc1',
              type: 'function',
              function: { name: 'read_file', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'tc1', content: '{"ok":true}' },
      ],
      pendingTurn: STALE_PENDING,
    });
    assert.equal(isPendingTurnObsolete(chat), false);
  });

  test('false when no pendingTurn', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Done.' },
      ],
    });
    assert.equal(isPendingTurnObsolete(chat), false);
  });

  test('false when last assistant has empty prose (still recoverable)', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: '' },
      ],
      pendingTurn: STALE_PENDING,
    });
    assert.equal(isPendingTurnObsolete(chat), false);
  });
});

describe('clearStalePendingTurn + shouldOfferRecovery (obsolete)', () => {
  test('clears stale pending so recovery is not offered', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Finished reply.' },
      ],
      pendingTurn: STALE_PENDING,
    });
    assert.equal(shouldOfferRecovery(chat), false);
    clearStalePendingTurn(chat);
    assert.equal(chat.pendingTurn, undefined);
    assert.equal(shouldOfferRecovery(chat), false);
  });

  test('still offers recovery for genuine interrupt (user tail)', () => {
    const chat = makeChat({ pendingTurn: STALE_PENDING });
    clearStalePendingTurn(chat);
    assert.equal(chat.pendingTurn?.content, 'partial checkpoint');
    assert.equal(shouldOfferRecovery(chat), true);
  });
});
