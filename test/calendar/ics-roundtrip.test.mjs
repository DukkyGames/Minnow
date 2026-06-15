/**
 * ICS import/export round-trip parity tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCalendarDbForTests, listCalendars } from '../../server/calendar/store.js';
import {
  exportCalendarIcs,
  icsEscape,
  importIcsToCalendar,
  parseIcsContent,
} from '../../server/calendar/ics.js';

const FIXTURE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Odysseus//Calendar//EN
X-WR-CALNAME:Work\\,Home
BEGIN:VEVENT
UID:33333333-3333-3333-3333-333333333333
SUMMARY:Team standup
DTSTART:20260602T100000Z
DTEND:20260602T103000Z
DESCRIPTION:Line one\\nLine two
LOCATION:Room A
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
BEGIN:VEVENT
UID:44444444-4444-4444-4444-444444444444
SUMMARY:Holiday
DTSTART;VALUE=DATE:20260602
DTEND;VALUE=DATE:20260603
END:VEVENT
END:VCALENDAR`;

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-calendar-ics-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
});

after(async () => {
  closeCalendarDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('calendar ics', () => {
  test('icsEscape matches RFC 5545 TEXT escaping', () => {
    assert.equal(icsEscape('Work,Home'), 'Work\\,Home');
    assert.equal(icsEscape('Team;Project'), 'Team\\;Project');
    assert.equal(icsEscape('C:\\Users'), 'C:\\\\Users');
    assert.equal(icsEscape('a\nb'), 'a\\nb');
  });

  test('parseIcsContent reads timed, all-day, and RRULE events', () => {
    const events = parseIcsContent(FIXTURE_ICS);
    assert.equal(events.length, 2);

    const timed = events.find((event) => event.title === 'Team standup');
    assert.ok(timed);
    assert.equal(timed.startsAt, '2026-06-02T10:00:00.000Z');
    assert.equal(timed.endsAt, '2026-06-02T10:30:00.000Z');
    assert.match(String(timed.rrule ?? ''), /FREQ=WEEKLY/);

    const allDay = events.find((event) => event.title === 'Holiday');
    assert.ok(allDay);
    assert.equal(allDay.allDay, true);
  });

  test('import then export preserves core event fields', () => {
    const calendarId = listCalendars()[0].id;
    importIcsToCalendar(calendarId, FIXTURE_ICS);
    const exported = exportCalendarIcs(calendarId);
    const roundTrip = parseIcsContent(exported);

    const originalTimed = parseIcsContent(FIXTURE_ICS).find((e) => e.title === 'Team standup');
    const exportedTimed = roundTrip.find((e) => e.title === 'Team standup');
    assert.ok(originalTimed && exportedTimed);
    assert.equal(exportedTimed.startsAt, originalTimed.startsAt);
    assert.equal(exportedTimed.endsAt, originalTimed.endsAt);
    assert.equal(exportedTimed.location, originalTimed.location);
  });
});
