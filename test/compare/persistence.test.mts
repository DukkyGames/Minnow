/**
 * Compare persistence merge + win-rate aggregation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeCompareVotes } from '../../src/compare/persistence.ts';
import { aggregateWinRates } from '../../src/compare/win-rates.ts';
import type { CompareVote } from '../../src/compare/types.ts';

const BASE_VOTE: CompareVote = {
  id: 'vote-1',
  startedAt: '2026-06-01T12:00:00.000Z',
  completedAt: '2026-06-01T12:01:00.000Z',
  prompt: 'Hello',
  left: { providerId: 'local', modelId: 'alpha' },
  right: { providerId: 'cloud', modelId: 'beta' },
  assignment: { leftAlias: 'A', rightAlias: 'B' },
  winner: 'left',
  revealed: true,
};

describe('compare persistence merge', () => {
  test('server row wins over local duplicate id', () => {
    const local = [{ ...BASE_VOTE, prompt: 'local copy' }];
    const server = [{ ...BASE_VOTE, prompt: 'server copy' }];
    const merged = mergeCompareVotes(server, local);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].prompt, 'server copy');
  });
});

describe('compare win rates', () => {
  test('aggregates wins and losses with fixed fixtures', () => {
    const votes: CompareVote[] = [
      BASE_VOTE,
      {
        ...BASE_VOTE,
        id: 'vote-2',
        winner: 'right',
        completedAt: '2026-06-02T12:00:00.000Z',
      },
      {
        ...BASE_VOTE,
        id: 'vote-3',
        winner: 'tie',
        completedAt: '2026-06-03T12:00:00.000Z',
      },
    ];

    const rows = aggregateWinRates(votes);
    const alpha = rows.find((r) => r.modelId === 'alpha');
    const beta = rows.find((r) => r.modelId === 'beta');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(alpha.wins, 1);
    assert.equal(alpha.losses, 1);
    assert.equal(alpha.ties, 1);
    assert.equal(beta.wins, 1);
    assert.equal(beta.losses, 1);
    assert.equal(alpha.winRate, 0.5);
  });
});
