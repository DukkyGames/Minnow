/**
 * manage_calendar list pagination and truncation messaging.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { toolManageCalendar } from '../../server/calendar/tool-handler.js';
import { closeCalendarDbForTests, createEvent, listCalendars } from '../../server/calendar/store.js';

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-calendar-tool-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
});

after(async () => {
  closeCalendarDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('manage_calendar list', () => {
  test('reports truncation with offset hint when more than default limit', async () => {
    const calendarId = listCalendars()[0].id;
    for (let i = 0; i < 60; i += 1) {
      const hour = String(8 + (i % 10)).padStart(2, '0');
      createEvent({
        calendarId,
        title: `Event ${i}`,
        startsAt: `2026-06-15T${hour}:00:00.000Z`,
        endsAt: `2026-06-15T${hour}:30:00.000Z`,
      });
    }

    const result = await toolManageCalendar({
      action: 'list',
      from: '2026-06-15T00:00:00.000Z',
      to: '2026-06-16T00:00:00.000Z',
    });

    assert.match(result, /50 of 60, offset 0/);
    assert.match(result, /offset=50 to fetch the next page/);
  });

  test('returns full count header when not truncated', async () => {
    const calendarId = listCalendars()[0].id;
    createEvent({
      calendarId,
      title: 'Only one',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const result = await toolManageCalendar({
      action: 'list',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
    });

    assert.match(result, /^Events \(1\):/);
    assert.doesNotMatch(result, / of /);
  });

  test('honors offset for pagination', async () => {
    const result = await toolManageCalendar({
      action: 'list',
      from: '2026-06-15T00:00:00.000Z',
      to: '2026-06-16T00:00:00.000Z',
      limit: 10,
      offset: 50,
    });

    assert.match(result, /10 of 60, offset 50/);
    assert.match(result, /Event 49/);
    assert.doesNotMatch(result, /Event 0/);
  });
});
