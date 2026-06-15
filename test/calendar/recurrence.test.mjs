/**
 * Recurrence expansion tests with fixed expected occurrences.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expandEventsInRange } from '../../server/calendar/recurrence.js';

describe('calendar recurrence', () => {
  test('expands weekly RRULE occurrences inside range', () => {
    const master = {
      id: '11111111-1111-1111-1111-111111111111',
      calendarId: 'cal-1',
      title: 'Weekly review',
      startsAt: '2026-06-02T15:00:00.000Z',
      endsAt: '2026-06-02T16:00:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };

    const expanded = expandEventsInRange(
      [master],
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T23:59:59.999Z'),
    );

    assert.equal(expanded.length, 4);
    assert.equal(expanded[0].startsAt, '2026-06-08T15:00:00.000Z');
    assert.equal(expanded[1].startsAt, '2026-06-15T15:00:00.000Z');
    assert.equal(expanded[2].startsAt, '2026-06-22T15:00:00.000Z');
    assert.equal(expanded[3].startsAt, '2026-06-29T15:00:00.000Z');
  });

  test('includes non-recurring overlap without expansion', () => {
    const event = {
      id: '22222222-2222-2222-2222-222222222222',
      calendarId: 'cal-1',
      title: 'One-off',
      startsAt: '2026-06-10T12:00:00.000Z',
      endsAt: '2026-06-10T13:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };

    const expanded = expandEventsInRange(
      [event],
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T23:59:59.999Z'),
    );

    assert.equal(expanded.length, 1);
    assert.equal(expanded[0].id, event.id);
  });
});
