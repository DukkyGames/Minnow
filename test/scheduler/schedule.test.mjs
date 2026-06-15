/**
 * Scheduler next-run calculation tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  computeNextRun,
  parseInterval,
  validateCronExpression,
} from '../../server/scheduler/schedule.js';

describe('scheduler schedule', () => {
  test('parseInterval converts duration units', () => {
    assert.equal(parseInterval('60s'), 60_000);
    assert.equal(parseInterval('5m'), 300_000);
    assert.equal(parseInterval('2h'), 7_200_000);
  });

  test('parseInterval enforces minimum duration', () => {
    assert.throws(() => parseInterval('30s'), /at least 60 seconds/);
  });

  test('computeNextRun schedules interval jobs from now', () => {
    const now = new Date('2026-06-14T12:00:00.000Z');
    const next = computeNextRun(
      { schedule: { kind: 'interval', value: '5m' } },
      now,
    );
    assert.equal(next, '2026-06-14T12:05:00.000Z');
  });

  test('computeNextRun uses cron for cron jobs', () => {
    const now = new Date('2026-06-14T12:30:00.000Z');
    const next = computeNextRun(
      { schedule: { kind: 'cron', value: '0 * * * *' } },
      now,
    );
    assert.equal(next, '2026-06-14T13:00:00.000Z');
  });

  test('validateCronExpression accepts five-field cron', () => {
    assert.doesNotThrow(() => validateCronExpression('0 9 * * 1-5'));
  });

  test('validateCronExpression rejects empty values', () => {
    assert.throws(() => validateCronExpression(''), /required/);
  });
});
