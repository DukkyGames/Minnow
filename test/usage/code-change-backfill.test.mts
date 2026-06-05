/**
 * History backfill for chat codeChangeTotals.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Chat, Message } from '../../src/types.ts';
import { rebuildCodeChangeTotalsFromHistory } from '../../src/usage/code-change-backfill.ts';

function makeChat(history: Message[]): Chat {
  return {
    id: 'c1',
    name: 'Test',
    workspacePath: '/tmp/ws',
    modelId: 'm',
    modeId: 'build',
    history,
    lastStats: null,
    modelInfo: {},
    updatedAt: 0,
  };
}

describe('code-change-backfill', () => {
  test('sums persisted codeChange on tool rows', async () => {
    const history: Message[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'save_file', arguments: '{"path":"a.ts","content":"x"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc1',
        content: 'Saved',
        codeChange: { additions: 4, deletions: 1, path: 'a.ts', source: 'file-tool' },
      },
    ];
    const chat = makeChat(history);
    await rebuildCodeChangeTotalsFromHistory(chat, { force: true });
    assert.deepEqual(chat.codeChangeTotals, { additions: 4, deletions: 1 });
    assert.ok(chat.codeChangeBackfillAt);
  });

  test('backfills save_file from args when row lacks codeChange', async () => {
    const history: Message[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: {
              name: 'save_file',
              arguments: JSON.stringify({ path: 'new.ts', content: 'line1\nline2' }),
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'tc1', content: 'Saved' },
    ];
    const chat = makeChat(history);
    await rebuildCodeChangeTotalsFromHistory(chat, { force: true });
    assert.equal(chat.codeChangeTotals?.additions, 2);
    assert.equal(chat.codeChangeTotals?.deletions, 0);
  });
});
