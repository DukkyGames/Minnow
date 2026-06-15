/**
 * Scheduler schedule display and cron builder tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cronUiToExpression,
  describeSchedule,
  scheduleToUi,
  uiToSchedule,
  validateScheduleUi,
} from '../../src/scheduler/schedule-display.ts';

describe('schedule display', () => {
  test('describeSchedule formats interval shorthand', () => {
    assert.equal(describeSchedule({ kind: 'interval', value: '5m' }), 'Every 5 minutes');
    assert.equal(describeSchedule({ kind: 'interval', value: '2h' }), 'Every 2 hours');
  });

  test('scheduleToUi detects daily cron', () => {
    const ui = scheduleToUi({ kind: 'cron', value: '0 9 * * *' });
    assert.equal(ui.cron.pattern, 'daily');
    assert.equal(ui.cron.hour, 9);
    assert.equal(ui.cron.minute, 0);
  });

  test('scheduleToUi detects weekdays cron', () => {
    const ui = scheduleToUi({ kind: 'cron', value: '30 8 * * 1-5' });
    assert.equal(ui.cron.pattern, 'weekdays');
    assert.equal(ui.cron.hour, 8);
    assert.equal(ui.cron.minute, 30);
  });

  test('cronUiToExpression builds weekly days', () => {
    const expr = cronUiToExpression({
      pattern: 'weekly',
      minute: 15,
      hour: 10,
      weekDays: [1, 3, 5],
      customExpression: '',
    });
    assert.equal(expr, '15 10 * * 1,3,5');
  });

  test('uiToSchedule round-trips weekdays preset', () => {
    const ui = scheduleToUi({ kind: 'cron', value: '0 9 * * 1-5' });
    assert.deepEqual(uiToSchedule(ui), { kind: 'cron', value: '0 9 * * 1-5' });
  });

  test('validateScheduleUi rejects weekly with no days', () => {
    const ui = scheduleToUi({ kind: 'cron', value: '0 9 * * 1' });
    ui.cron.pattern = 'weekly';
    ui.cron.weekDays = [];
    const result = validateScheduleUi(ui);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /at least one day/i);
    }
  });

  test('describeSchedule humanizes weekdays cron', () => {
    const label = describeSchedule({ kind: 'cron', value: '0 9 * * 1-5' });
    assert.match(label, /Weekdays at/i);
  });
});
