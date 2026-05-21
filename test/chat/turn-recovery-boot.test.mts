/**
 * Boot recovery must not treat finished chats as interrupted.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  hasOrphanUserTurnAwaitingReply,
  hasOrphanToolTailAwaitingReply,
} from '../../src/chat/turn-recovery.ts';
import {
  isPendingTurnObsolete,
  shouldOfferRecovery,
} from '../../src/state/pending-turn-shape.ts';
import type { Chat } from '../../src/types.ts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const STARTED = 1710000000000;

function makeFinishedChatWithStalePending(): Chat {
  return {
    id: CHAT_ID,
    name: 'Finished',
    workspacePath: '',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Final answer.' },
    ],
    pendingTurn: {
      role: 'assistant',
      content: 'stale checkpoint',
      startedAt: STARTED,
    },
    lastStats: null,
    modelInfo: {},
    updatedAt: STARTED,
  };
}

describe('boot recovery gate (finished chat + stale pendingTurn)', () => {
  test('obsolete pending is not recoverable and not an orphan tail', () => {
    const chat = makeFinishedChatWithStalePending();
    assert.equal(isPendingTurnObsolete(chat), true);
    assert.equal(shouldOfferRecovery(chat), false);
    assert.equal(hasOrphanUserTurnAwaitingReply(chat), false);
    assert.equal(hasOrphanToolTailAwaitingReply(chat), false);
  });
});
