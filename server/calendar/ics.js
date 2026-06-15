/**
 * ICS import/export helpers (RFC 5545) using node-ical.
 */

import ical from 'node-ical';
import {
  createEvent,
  getCalendarDb,
  listEvents,
  upsertRemoteEvent,
} from './store.js';

/**
 * Escape TEXT values for iCalendar fields (RFC 5545 §3.3.11).
 * @param {string} text
 */
export function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/**
 * Normalize parsed datetime to ISO string stored in SQLite.
 * @param {Date | { toJSDate?: () => Date }} value
 * @param {boolean} allDay
 */
function toIso(value, allDay) {
  const date = value instanceof Date ? value : value?.toJSDate?.() ?? new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid ICS datetime');
  }
  if (allDay) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  return date.toISOString();
}

/**
 * Parse ICS bytes into normalized event payloads.
 * @param {string | Buffer} content
 */
export function parseIcsContent(content) {
  const parsed = ical.sync.parseICS(String(content));
  const events = [];

  for (const item of Object.values(parsed)) {
    if (!item || item.type !== 'VEVENT') {
      continue;
    }

    const allDay = Boolean(item.datetype === 'date' || item.start?.dateOnly);
    const startsAt = toIso(item.start, allDay);
    const endSource = item.end ?? item.start;
    let endsAt = toIso(endSource, allDay);

    if (allDay && Date.parse(endsAt) <= Date.parse(startsAt)) {
      const endDate = new Date(Date.parse(startsAt));
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      endsAt = endDate.toISOString();
    } else if (!allDay && Date.parse(endsAt) <= Date.parse(startsAt)) {
      endsAt = new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString();
    }

    events.push({
      id: item.uid ? String(item.uid) : undefined,
      title: String(item.summary ?? 'Untitled event').trim() || 'Untitled event',
      description: item.description ? String(item.description) : '',
      location: item.location ? String(item.location) : '',
      startsAt,
      endsAt,
      allDay,
      rrule: item.rrule ? item.rrule.toString().replace(/^RRULE:/i, 'RRULE:') : undefined,
      source: 'ics',
    });
  }

  return events;
}

/**
 * Import parsed ICS events into a calendar.
 * @param {string} calendarId
 * @param {string | Buffer} content
 */
export function importIcsToCalendar(calendarId, content) {
  const events = parseIcsContent(content);
  const imported = [];

  for (const event of events) {
    const created = createEvent({
      ...event,
      calendarId,
      source: 'ics',
    });
    imported.push(created);
  }

  return imported;
}

/**
 * Format one event as VEVENT lines.
 * @param {object} event
 */
function formatVevent(event) {
  const lines = ['BEGIN:VEVENT', `UID:${event.id}`, `SUMMARY:${icsEscape(event.title)}`];

  if (event.allDay) {
    const start = event.startsAt.slice(0, 10).replace(/-/g, '');
    const end = event.endsAt.slice(0, 10).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    const start = event.startsAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const end = event.endsAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${icsEscape(event.location)}`);
  }
  if (event.rrule) {
    const rrule = event.rrule.startsWith('RRULE:') ? event.rrule : `RRULE:${event.rrule}`;
    lines.push(rrule);
  }

  lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Export one calendar to ICS text.
 * @param {string} calendarId
 */
export function exportCalendarIcs(calendarId) {
  const database = getCalendarDb();
  const calendar = database.prepare('SELECT * FROM calendars WHERE id = ?').get(calendarId);
  if (!calendar) {
    throw new Error('Calendar not found');
  }

  const events = listEvents({ calendarId, expandRecurrence: false });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Minnow//Calendar//EN',
    `X-WR-CALNAME:${icsEscape(calendar.name)}`,
  ];

  for (const event of events) {
    lines.push(...formatVevent(event));
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Build a single VEVENT ICS document for CalDAV writeback.
 * @param {object} event
 */
export function buildEventIcal(event) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Minnow//Calendar//EN',
    ...formatVevent(event),
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** @param {object} input */
export function upsertIcsEvent(input) {
  return upsertRemoteEvent(input);
}
