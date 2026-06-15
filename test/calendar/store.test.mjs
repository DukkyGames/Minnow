/**
 * Calendar store CRUD tests with fixed timestamps.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  closeCalendarDbForTests,
  createCalendar,
  createEvent,
  deleteEvent,
  getEventById,
  listCalendars,
  listEvents,
  resetCalendarData,
  updateEvent,
} from '../../server/calendar/store.js';

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-calendar-store-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
});

after(async () => {
  closeCalendarDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('calendar store', () => {
  test('creates default Personal calendar on first open', () => {
    const calendars = listCalendars();
    assert.equal(calendars.length, 1);
    assert.equal(calendars[0].name, 'Personal');
  });

  test('creates, updates, and deletes an event with fixed ISO timestamps', () => {
    const calendarId = listCalendars()[0].id;

    const created = createEvent({
      calendarId,
      title: 'Standup',
      startsAt: '2026-06-15T13:00:00.000Z',
      endsAt: '2026-06-15T13:30:00.000Z',
      description: 'Daily sync',
      location: 'Room A',
    });

    assert.equal(created.title, 'Standup');
    assert.equal(created.startsAt, '2026-06-15T13:00:00.000Z');

    const updated = updateEvent(created.id, {
      title: 'Team standup',
      endsAt: '2026-06-15T13:45:00.000Z',
    });
    assert.equal(updated.title, 'Team standup');
    assert.equal(updated.endsAt, '2026-06-15T13:45:00.000Z');

    deleteEvent(created.id);
    assert.equal(getEventById(created.id), null);
  });

  test('rejects events where endsAt is not after startsAt', () => {
    const calendarId = listCalendars()[0].id;
    assert.throws(
      () =>
        createEvent({
          calendarId,
          title: 'Invalid',
          startsAt: '2026-06-15T14:00:00.000Z',
          endsAt: '2026-06-15T13:00:00.000Z',
        }),
      /endsAt must be after startsAt/,
    );
  });

  test('lists events in a date range', () => {
    const calendarId = listCalendars()[0].id;
    createEvent({
      calendarId,
      title: 'In range',
      startsAt: '2026-06-20T10:00:00.000Z',
      endsAt: '2026-06-20T11:00:00.000Z',
    });
    createEvent({
      calendarId,
      title: 'Out of range',
      startsAt: '2026-07-20T10:00:00.000Z',
      endsAt: '2026-07-20T11:00:00.000Z',
    });

    const rows = listEvents({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.999Z',
      expandRecurrence: false,
    });
    assert.ok(rows.some((row) => row.title === 'In range'));
    assert.ok(!rows.some((row) => row.title === 'Out of range'));
  });

  test('resetCalendarData leaves one Personal calendar and zero events', () => {
    const calendarId = listCalendars()[0].id;
    createEvent({
      calendarId,
      title: 'Before reset',
      startsAt: '2026-06-15T10:00:00.000Z',
      endsAt: '2026-06-15T11:00:00.000Z',
    });
    createCalendar({ name: 'Work' });

    resetCalendarData();

    const calendars = listCalendars();
    assert.equal(calendars.length, 1);
    assert.equal(calendars[0].name, 'Personal');
    const events = listEvents({ expandRecurrence: false });
    assert.equal(events.length, 0);
  });
});
