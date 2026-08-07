import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatRunDuration,
  formatRunSummary,
  formatSecondsClock,
  normalizeResearchStats,
} from '../../src/research/run-summary.ts';

describe('run summary', () => {
  test('reads the engine wire shape, which uses capitalised keys', () => {
    // server/research/engine.js writes { Duration: `${elapsed.toFixed(1)}s`, Rounds, URLs }.
    const summary = normalizeResearchStats(
      { Duration: '476.8s', Rounds: 3, URLs: 35 } as never,
      23,
    );
    assert.equal(summary.rounds, 3);
    assert.equal(summary.duration, '7:57');
    assert.equal(summary.sources, 23);
    assert.equal(formatRunSummary(summary), '23 sources · 3 rounds · 7:57');
  });

  test('reads the lower-cased shape too', () => {
    const summary = normalizeResearchStats({ rounds: 2, sources: 9, durationSeconds: 68 }, 0);
    assert.equal(formatRunSummary(summary), '9 sources · 2 rounds · 1:08');
  });

  test('falls back to the source count when stats are missing entirely', () => {
    assert.equal(formatRunSummary(normalizeResearchStats(undefined, 4)), '4 sources');
  });

  test('drops parts it has no number for rather than printing a dash', () => {
    assert.equal(formatRunSummary(normalizeResearchStats(undefined, 0)), '');
  });

  test('singular units read correctly', () => {
    const summary = normalizeResearchStats({ rounds: 1, sources: 1, durationSeconds: 5 }, 0);
    assert.equal(formatRunSummary(summary), '1 source · 1 round · 0:05');
  });

  test('duration parsing', () => {
    assert.equal(formatRunDuration('476.8s'), '7:57');
    assert.equal(formatRunDuration('9s'), '0:09');
    assert.equal(formatRunDuration('2:48'), '2:48');
    assert.equal(formatRunDuration(''), '');
    assert.equal(formatSecondsClock(0), '0:00');
    assert.equal(formatSecondsClock(3599), '59:59');
  });
});
