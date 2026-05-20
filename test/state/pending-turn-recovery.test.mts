/**
 * Recovery eligibility and stale pending cleanup.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearStalePendingTurn,
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

describe('shouldOfferRecovery', () => {
  test('true when pendingTurn is valid', () => {
    const chat = makeChat({
      pendingTurn: {
        role: 'assistant',
        content: 'partial',
        startedAt: FIXED_STARTED,
      },
    });
    assert.equal(shouldOfferRecovery(chat), true);
  });

  test('false when pendingTurn missing', () => {
    assert.equal(shouldOfferRecovery(makeChat()), false);
  });
});

describe('clearStalePendingTurn', () => {
  test('clears pending when history has no user message', () => {
    const chat = makeChat({
      history: [],
      pendingTurn: {
        role: 'assistant',
        content: 'orphan',
        startedAt: FIXED_STARTED,
      },
    });
    clearStalePendingTurn(chat);
    assert.equal(chat.pendingTurn, undefined);
  });

  test('keeps pending when user message exists', () => {
    const chat = makeChat({
      pendingTurn: {
        role: 'assistant',
        content: 'partial',
        startedAt: FIXED_STARTED,
      },
    });
    clearStalePendingTurn(chat);
    assert.equal(chat.pendingTurn?.content, 'partial');
  });
});
