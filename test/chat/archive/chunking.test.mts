/**
 * Archive range chunking for bundler token budget (MIN-139).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { splitRangeForBundling, BUNDLER_TOKEN_BUDGET } from '../../../src/chat/archive/chunking.ts';
import type { ApiMessage } from '../../../src/types.ts';

function userMsg(text: string): ApiMessage {
  return { role: 'user', content: text };
}

function assistantMsg(text: string): ApiMessage {
  return { role: 'assistant', content: text };
}

describe('splitRangeForBundling', () => {
  test('returns single range when under budget', () => {
    const range = {
      startIndex: 0,
      endIndex: 2,
      sourceTurnIndices: [0, 1],
    };
    const turns = [userMsg('short'), assistantMsg('reply')];
    const chunks = splitRangeForBundling(range, turns, BUNDLER_TOKEN_BUDGET);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0].sourceTurnIndices, [0, 1]);
  });

  test('splits oversized range into consecutive sub-ranges', () => {
    const long = 'word '.repeat(8_000);
    const range = {
      startIndex: 0,
      endIndex: 4,
      sourceTurnIndices: [0, 1, 2, 3],
    };
    const turns = [
      userMsg(long),
      assistantMsg(long),
      userMsg(long),
      assistantMsg(long),
    ];
    const chunks = splitRangeForBundling(range, turns, 500);
    assert.ok(chunks.length > 1);
    const merged = chunks.flatMap((c) => c.sourceTurnIndices);
    assert.deepEqual(merged, [0, 1, 2, 3]);
  });
});
