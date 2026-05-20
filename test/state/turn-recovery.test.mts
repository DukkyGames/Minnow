/**
 * Orphan user tail detection (no pendingTurn checkpoint, last row is user).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getOrphanUserTurnIndex,
  hasOrphanUserTurnAwaitingReply,
} from '../../src/chat/turn-recovery.ts';
import type { Chat } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STARTED = 1710000000000;

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Test',
    workspacePath: '',
    modelId: 'm1',
    history: [{ role: 'user', content: 'Hi' }],
    lastStats: null,
    modelInfo: {},
    updatedAt: STARTED,
    ...overrides,
  };
}

describe('hasOrphanUserTurnAwaitingReply', () => {
  test('true when last row is user and no pendingTurn', () => {
    assert.equal(hasOrphanUserTurnAwaitingReply(makeChat()), true);
  });

  test('false when pendingTurn is valid', () => {
    const chat = makeChat({
      pendingTurn: {
        role: 'assistant',
        content: 'partial',
        startedAt: STARTED,
      },
    });
    assert.equal(hasOrphanUserTurnAwaitingReply(chat), false);
  });

  test('false when last row is assistant', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    });
    assert.equal(hasOrphanUserTurnAwaitingReply(chat), false);
  });
});

describe('getOrphanUserTurnIndex', () => {
  test('returns last user index when orphan', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Mid' },
        { role: 'user', content: 'Last' },
      ],
    });
    assert.equal(getOrphanUserTurnIndex(chat), 2);
  });

  test('returns null when not orphan', () => {
    assert.equal(getOrphanUserTurnIndex(makeChat({ history: [] })), null);
  });
});
