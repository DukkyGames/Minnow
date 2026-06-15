/**
 * Calendar persistence paths under ~/.minnow/calendar/.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** SQLite database for calendars and events. */
export function calendarDbPath() {
  return path.join(getMinnowHome(), 'calendar', 'calendar.db');
}

/** Encrypted CalDAV account password envelopes. */
export function caldavSecretPath(accountId) {
  return path.join(getMinnowHome(), 'calendar', 'secrets', `${accountId}.json`);
}

/** Reminder dedupe state for upcoming event notifications. */
export function calendarRemindersPath() {
  return path.join(getMinnowHome(), 'calendar', 'reminders-sent.json');
}
