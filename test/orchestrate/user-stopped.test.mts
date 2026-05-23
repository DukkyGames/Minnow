/**
 * User-stopped orchestrate session detection.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isUserStoppedChat } from '../../src/chat/orchestrate/user-stopped.ts';
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';

function board(): OrchestrateBoardState {
  return {
    planPath: 'p.md',
    startedAt: 1_700_000_000_000,
    lastUpdatedAt: 1_700_000_000_000,
    waves: [{ id: 'W1', status: 'planned' }],
    tasks: [{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'planned' }],
  };
}

describe('isUserStoppedChat', () => {
  test('true when latest assistant is stopped and work remains', () => {
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      orchestrateBoard: board(),
      history: [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: '…', stopped: true },
      ],
    } as Chat;
    assert.equal(isUserStoppedChat(chat), true);
  });

  test('false after user sends a follow-up message', () => {
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      orchestrateBoard: board(),
      history: [
        { role: 'assistant', content: '…', stopped: true },
        { role: 'user', content: 'resume manually' },
      ],
    } as Chat;
    assert.equal(isUserStoppedChat(chat), false);
  });

  test('false when plan is complete', () => {
    const completeBoard: OrchestrateBoardState = {
      ...board(),
      tasks: [{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'complete' }],
    };
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      orchestrateBoard: completeBoard,
      history: [{ role: 'assistant', content: 'done', stopped: true }],
    } as Chat;
    assert.equal(isUserStoppedChat(chat), false);
  });
});
