/**
 * Context notice persistence.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { appendContextNoticeIfNeeded } from '../../src/chat/context/context-notice.ts';
import { historyToApiMessagesForEstimate } from '../../src/chat/prompts/token-estimate-core.ts';
import type { Chat } from '../../src/types.ts';

describe('context notice', () => {
  test('appendContextNoticeIfNeeded dedupes identical consecutive notices', () => {
    const chat: Chat = {
      id: 'c1',
      name: 'Test',
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    appendContextNoticeIfNeeded(chat, {
      policy: 'summarize',
      droppedTurns: 3,
      summaryText: 'Prior work summary',
    });
    appendContextNoticeIfNeeded(chat, {
      policy: 'summarize',
      droppedTurns: 3,
      summaryText: 'Prior work summary',
    });
    assert.equal(chat.history.length, 1);
    assert.equal(chat.history[0].role, 'context');
  });

  test('historyToApiMessagesForEstimate skips context notices', () => {
    const api = historyToApiMessagesForEstimate([
      { role: 'user', content: 'hello' },
      {
        role: 'context',
        policy: 'summarize',
        droppedTurns: 2,
        summaryText: 'hidden',
        createdAt: 1,
      },
      { role: 'assistant', content: 'hi' },
    ]);
    assert.deepEqual(
      api.map((m) => m.role),
      ['user', 'assistant'],
    );
  });
});
