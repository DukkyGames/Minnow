/**
 * Phase C.2 archive policy: requires full history — never page into absolute indices.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyArchivePolicy } from '../../../src/chat/archive/index.ts';
import { DEFAULT_ARCHIVE_CONFIG } from '../../../src/chat/archive/types.ts';
import type { ApiMessage, Chat, Message } from '../../../src/types.ts';

function makeChat(history: Message[], historyLoaded: boolean): Chat {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Archive test',
    workspacePath: '/ws/test',
    modelId: '',
    modeId: 'build',
    history,
    historyLoaded,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1_700_000_000_000,
    lastMessageAt: 1_700_000_000_000,
  };
}

describe('archive policy + lazy history (C.2)', () => {
  test('applyArchivePolicy throws when history is not loaded', async () => {
    const chat = makeChat([], false);
    await assert.rejects(
      () =>
        applyArchivePolicy([], {
          chat,
          agentConfig: {
            maxInputTokens: null,
            enforcementPolicy: 'archive',
            archive: DEFAULT_ARCHIVE_CONFIG,
          },
        }),
      /ensureChatHistoryLoaded|full history/i,
    );
  });

  test('applyArchivePolicy sees absolute indices against the full loaded history', async () => {
    const history: Message[] = [];
    for (let i = 0; i < 12; i += 1) {
      history.push({ role: 'user', content: `u${i}` }, { role: 'assistant', content: `a${i}` });
    }
    const chat = makeChat(history, true);
    const messages: ApiMessage[] = [
      { role: 'system', content: 'sys' },
      ...history.map((m) =>
        m.role === 'user' || m.role === 'assistant'
          ? { role: m.role, content: m.content }
          : { role: 'user', content: '' },
      ),
    ];

    // With a high minRecentTurns floor, policy is a no-op but still reads full length.
    const result = await applyArchivePolicy(messages, {
      chat,
      agentConfig: {
        maxInputTokens: null,
        enforcementPolicy: 'archive',
        archive: {
          ...DEFAULT_ARCHIVE_CONFIG,
          stalenessTurns: 100,
          minRecentTurns: 20,
        },
      },
    });
    assert.equal(result.archived, 0);
    assert.equal(chat.history.length, 24);
    assert.equal(chat.historyLoaded, true);
  });
});
