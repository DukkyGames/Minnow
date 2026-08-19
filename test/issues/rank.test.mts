/**
 * Fractional rank helpers for Issues list/board order.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  compareIssueRank,
  rankBetween,
  rankForMove,
  rankInitial,
  ranksAfterReorder,
} from '../../src/issues/rank.ts';

describe('issue rank', () => {
  test('rankBetween lands strictly between neighbours', () => {
    const mid = rankBetween('a', 'c');
    assert.equal(mid > 'a', true);
    assert.equal(mid < 'c', true);
    const deeper = rankBetween('a', 'b');
    assert.equal(deeper > 'a', true);
    assert.equal(deeper < 'b', true);
  });

  test('rankInitial is a mid-alphabet key', () => {
    assert.equal(rankInitial().length > 0, true);
    assert.equal(rankBetween(null, rankInitial()) < rankInitial(), true);
    assert.equal(rankBetween(rankInitial(), null) > rankInitial(), true);
  });

  test('compareIssueRank puts ranked rows before unranked ones', () => {
    assert.equal(compareIssueRank('a', 'b'), -1);
    assert.equal(compareIssueRank('b', 'a'), 1);
    assert.equal(compareIssueRank('a', 'a'), 0);
    assert.equal(compareIssueRank('a', undefined), -1);
    assert.equal(compareIssueRank(undefined, 'a'), 1);
    assert.equal(compareIssueRank(undefined, undefined), 0);
  });

  test('rankForMove inserts between the visual neighbours', () => {
    const ids = ['ISS-1', 'ISS-2', 'ISS-3'];
    const ranks = new Map<string, string | undefined>([
      ['ISS-1', 'a'],
      ['ISS-2', 'm'],
      ['ISS-3', 'z'],
    ]);
    const moved = rankForMove(ids, ranks, 'ISS-3', 1);
    assert.equal(moved > 'a', true);
    assert.equal(moved < 'm', true);
  });

  test('moving the first of two unranked ids lands it second after sort', () => {
    const ids = ['CHE-1', 'MIN-1'];
    const existing = new Map<string, string | undefined>([
      ['CHE-1', undefined],
      ['MIN-1', undefined],
    ]);
    // rankForMove alone would write "h" onto CHE-1, which still sorts before
    // unranked MIN-1. Materializing both peers first is the real Alt+↓ path.
    const ranks = ranksAfterReorder(ids, existing, ['CHE-1'], 1);
    assert.ok(ranks.get('CHE-1'));
    assert.ok(ranks.get('MIN-1'));
    const sorted = [...ids].sort((a, b) => compareIssueRank(ranks.get(a), ranks.get(b)));
    assert.deepEqual(sorted, ['MIN-1', 'CHE-1']);
  });
});
