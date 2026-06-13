/**
 * Compare win-rate helpers and winner label formatting.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  aggregateWinRates,
  formatCompareWinnerLabel,
  normalizeCompareVote,
} from '../../src/compare/win-rates.ts';
import type { CompareVote } from '../../src/compare/types.ts';

const BASE_VOTE: CompareVote = {
  id: 'vote-1',
  startedAt: '2026-06-01T12:00:00.000Z',
  completedAt: '2026-06-01T12:01:00.000Z',
  prompt: 'Hello',
  slots: [
    { providerId: 'local', modelId: 'alpha', alias: 'A' },
    { providerId: 'cloud', modelId: 'beta', alias: 'B' },
  ],
  winner: 'left',
  revealed: true,
};

describe('normalizeCompareVote', () => {
  test('builds slots from legacy left/right when slots missing', () => {
    const legacy: CompareVote = {
      ...BASE_VOTE,
      slots: [],
      winner: 0,
      left: { providerId: 'local', modelId: 'alpha' },
      right: { providerId: 'cloud', modelId: 'beta' },
      assignment: { leftAlias: 'A', rightAlias: 'B' },
    };

    const normalized = normalizeCompareVote(legacy);
    assert.equal(normalized.slots.length, 2);
    assert.equal(normalized.slots[0]?.alias, 'A');
    assert.equal(normalized.slots[1]?.alias, 'B');
  });
});

describe('formatCompareWinnerLabel', () => {
  test('does not throw for numeric winner on legacy votes without slots', () => {
    const legacy: CompareVote = {
      ...BASE_VOTE,
      slots: [],
      winner: 0,
      left: { providerId: 'local', modelId: 'alpha' },
      right: { providerId: 'cloud', modelId: 'beta' },
      assignment: { leftAlias: 'A', rightAlias: 'B' },
    };

    assert.equal(formatCompareWinnerLabel(legacy), 'A wins');
    assert.equal(formatCompareWinnerLabel({ ...legacy, winner: 'both_bad' }), 'Both bad');
  });
});

describe('aggregateWinRates', () => {
  test('aggregates slot-index winners after legacy normalization', () => {
    const votes: CompareVote[] = [
      {
        ...BASE_VOTE,
        id: 'vote-legacy',
        slots: [],
        winner: 1,
        left: { providerId: 'local', modelId: 'alpha' },
        right: { providerId: 'cloud', modelId: 'beta' },
        assignment: { leftAlias: 'A', rightAlias: 'B' },
      },
    ];

    const rows = aggregateWinRates(votes);
    const beta = rows.find((r) => r.modelId === 'beta');
    const alpha = rows.find((r) => r.modelId === 'alpha');
    assert.ok(beta);
    assert.ok(alpha);
    assert.equal(beta.wins, 1);
    assert.equal(alpha.losses, 1);
  });
});
