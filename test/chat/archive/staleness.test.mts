/**
 * Archive staleness detection (MIN-139).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_ARCHIVE_CONFIG } from '../../../src/chat/archive/types.ts';
import {
  detectStaleTurnRanges,
  groupStaleTurnsIntoRanges,
  partitionHistoryTurns,
} from '../../../src/chat/archive/staleness.ts';
import type { Message } from '../../../src/types.ts';

function user(text: string): Message {
  return { role: 'user', content: text };
}

function assistant(text: string): Message {
  return { role: 'assistant', content: text };
}

describe('partitionHistoryTurns', () => {
  test('groups assistant and tool messages with preceding user', () => {
    const turns = partitionHistoryTurns([
      user('a'),
      assistant('b'),
      user('c'),
    ]);
    assert.equal(turns.length, 2);
    assert.deepEqual(turns[0], { turnIndex: 0, startIndex: 0, endIndex: 2 });
    assert.deepEqual(turns[1], { turnIndex: 1, startIndex: 2, endIndex: 3 });
  });
});

describe('detectStaleTurnRanges', () => {
  test('respects minRecentTurns floor', () => {
    const history: Message[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push(user(`u${i}`), assistant(`a${i}`));
    }
    const ranges = detectStaleTurnRanges(history, {
      ...DEFAULT_ARCHIVE_CONFIG,
      stalenessTurns: 20,
      minRecentTurns: 4,
    });
    assert.equal(ranges.length, 0);
  });

  test('archives turns older than stalenessTurns', () => {
    const history: Message[] = [];
    for (let i = 0; i < 30; i += 1) {
      history.push(user(`u${i}`), assistant(`a${i}`));
    }
    const ranges = detectStaleTurnRanges(history, {
      ...DEFAULT_ARCHIVE_CONFIG,
      stalenessTurns: 5,
      minRecentTurns: 2,
    });
    assert.ok(ranges.length > 0);
    assert.equal(ranges[0].startIndex, 0);
  });

  test('pressure trigger marks old turns stale', () => {
    const history: Message[] = [];
    for (let i = 0; i < 8; i += 1) {
      history.push(user('x'.repeat(500)), assistant('y'.repeat(500)));
    }
    const ranges = detectStaleTurnRanges(
      history,
      { ...DEFAULT_ARCHIVE_CONFIG, minRecentTurns: 2, stalenessTurns: 100 },
      { estimatedTokens: 9000, contextLimit: 10000 },
    );
    assert.ok(ranges.length > 0);
  });
});

describe('groupStaleTurnsIntoRanges', () => {
  test('merges consecutive stale turns', () => {
    const turns = partitionHistoryTurns([
      user('1'),
      user('2'),
      user('3'),
    ]);
    const ranges = groupStaleTurnsIntoRanges(turns, new Set([0, 1]));
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].startIndex, 0);
    assert.equal(ranges[0].endIndex, 2);
  });
});
