/**
 * Calendar persistence paths under ~/.minnow/calendar/.
 */

import fs from 'node:fs';
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

/** Directory holding encrypted CalDAV credential envelopes. */
export function calendarSecretsDir() {
  return path.join(getMinnowHome(), 'calendar', 'secrets');
}

/** Remove all CalDAV secret envelope files (reset / wipe). */
export function deleteAllCalendarSecrets() {
  const dir = calendarSecretsDir();
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.json')) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}

/** Remove reminder dedupe state file. */
export function deleteRemindersSentFile() {
  const remindersPath = calendarRemindersPath();
  if (fs.existsSync(remindersPath)) {
    fs.unlinkSync(remindersPath);
  }
}
