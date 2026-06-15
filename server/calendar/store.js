/**
 * SQLite-backed local calendar CRUD (~/.minnow/calendar/calendar.db).
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { getMinnowHome } from '../config/home.js';
import { calendarDbPath, deleteAllCalendarSecrets, deleteRemindersSentFile } from './paths.js';
import { expandEventsInRange } from './recurrence.js';

/** Default accent-like color for the built-in Personal calendar. */
const DEFAULT_CALENDAR_COLOR = '#6b9e78';

/** @type {import('better-sqlite3').Database | null} */
let db = null;

/**
 * Open (or create) the calendar database and ensure schema exists.
 * @returns {import('better-sqlite3').Database}
 */
export function getCalendarDb() {
  if (db) {
    return db;
  }

  const dir = path.dirname(calendarDbPath());
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(calendarDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  ensureDefaultCalendar(db);
  return db;
}

/** Close DB handle (tests). */
export function closeCalendarDbForTests() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * @param {import('better-sqlite3').Database} database
 */
function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS calendars (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '${DEFAULT_CALENDAR_COLOR}',
      source TEXT NOT NULL DEFAULT 'local',
      account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      timezone TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      rrule TEXT,
      recurrence_id TEXT,
      source TEXT NOT NULL DEFAULT 'local',
      remote_href TEXT,
      remote_etag TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS caldav_accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      secret_ref TEXT NOT NULL,
      last_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      account_id TEXT NOT NULL,
      calendar_href TEXT NOT NULL,
      sync_token TEXT,
      PRIMARY KEY (account_id, calendar_href)
    );

    CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
    CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
  `);
}

/**
 * @param {import('better-sqlite3').Database} database
 */
function ensureDefaultCalendar(database) {
  const row = database.prepare('SELECT id FROM calendars LIMIT 1').get();
  if (row) {
    return;
  }
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO calendars (id, name, color, source, account_id, created_at, updated_at)
       VALUES (?, ?, ?, 'local', NULL, ?, ?)`,
    )
    .run(randomUUID(), 'Personal', DEFAULT_CALENDAR_COLOR, now, now);
}

/**
 * @param {Record<string, unknown>} row
 */
function mapCalendarRow(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    source: row.source,
    accountId: row.account_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
function mapEventRow(row) {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    title: row.title,
    description: row.description || undefined,
    location: row.location || undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone ?? undefined,
    allDay: Boolean(row.all_day),
    rrule: row.rrule ?? undefined,
    recurrenceId: row.recurrence_id ?? undefined,
    source: row.source,
    remote:
      row.remote_href
        ? {
            href: row.remote_href,
            etag: row.remote_etag ?? undefined,
            accountId: undefined,
          }
        : undefined,
    updatedAt: row.updated_at,
    conflict: Boolean(row.remote_etag && row.source === 'local'),
  };
}

/** List all calendars. */
export function listCalendars() {
  const database = getCalendarDb();
  const rows = database.prepare('SELECT * FROM calendars ORDER BY name COLLATE NOCASE').all();
  return rows.map(mapCalendarRow);
}

/**
 * @param {object} input
 */
export function createCalendar(input) {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new Error('Calendar name is required');
  }
  const color = String(input.color ?? DEFAULT_CALENDAR_COLOR).trim() || DEFAULT_CALENDAR_COLOR;
  const now = new Date().toISOString();
  const calendar = {
    id: randomUUID(),
    name,
    color,
    source: input.source ? String(input.source) : 'local',
    accountId: input.accountId ? String(input.accountId) : undefined,
    createdAt: now,
    updatedAt: now,
  };

  getCalendarDb()
    .prepare(
      `INSERT INTO calendars (id, name, color, source, account_id, created_at, updated_at)
       VALUES (@id, @name, @color, @source, @accountId, @createdAt, @updatedAt)`,
    )
    .run({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      source: calendar.source,
      accountId: calendar.accountId ?? null,
      createdAt: calendar.createdAt,
      updatedAt: calendar.updatedAt,
    });

  return calendar;
}

/**
 * @param {string} id
 * @param {object} input
 */
export function updateCalendar(id, input) {
  const database = getCalendarDb();
  const existing = database.prepare('SELECT * FROM calendars WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('Calendar not found');
  }

  const name = input.name !== undefined ? String(input.name).trim() : existing.name;
  if (!name) {
    throw new Error('Calendar name is required');
  }
  const color =
    input.color !== undefined
      ? String(input.color).trim() || DEFAULT_CALENDAR_COLOR
      : existing.color;
  const updatedAt = new Date().toISOString();

  database
    .prepare('UPDATE calendars SET name = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(name, color, updatedAt, id);

  return mapCalendarRow({
    ...existing,
    name,
    color,
    updated_at: updatedAt,
  });
}

/**
 * Delete a local calendar. Refuses the last remaining calendar or synced calendars.
 * @param {string} id
 */
export function deleteCalendar(id) {
  const database = getCalendarDb();
  const count = database.prepare('SELECT COUNT(*) AS c FROM calendars').get().c;
  if (count <= 1) {
    throw new Error('Cannot delete the last calendar');
  }

  const existing = database.prepare('SELECT * FROM calendars WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('Calendar not found');
  }
  if (existing.source !== 'local') {
    throw new Error('Cannot delete synced calendars');
  }

  database.prepare('DELETE FROM calendars WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Wipe all calendar data and restore a fresh Personal calendar.
 */
export function resetCalendarData() {
  const database = getCalendarDb();
  const wipe = database.transaction(() => {
    database.prepare('DELETE FROM events').run();
    database.prepare('DELETE FROM sync_state').run();
    database.prepare('DELETE FROM calendars').run();
    database.prepare('DELETE FROM caldav_accounts').run();
    ensureDefaultCalendar(database);
  });
  wipe();
  deleteAllCalendarSecrets();
  deleteRemindersSentFile();
  return { ok: true };
}

/**
 * Validate event fields and normalize ISO timestamps.
 * @param {object} input
 * @param {string} [existingId]
 */
function normalizeEventInput(input, existingId) {
  const title = String(input.title ?? '').trim();
  if (!title) {
    throw new Error('Event title is required');
  }

  const calendarId = String(input.calendarId ?? '').trim();
  if (!calendarId) {
    throw new Error('calendarId is required');
  }

  const database = getCalendarDb();
  const calendar = database.prepare('SELECT id FROM calendars WHERE id = ?').get(calendarId);
  if (!calendar) {
    throw new Error('Calendar not found');
  }

  const startsAt = String(input.startsAt ?? '').trim();
  const endsAt = String(input.endsAt ?? '').trim();
  if (!startsAt || !endsAt) {
    throw new Error('startsAt and endsAt are required');
  }

  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('startsAt and endsAt must be valid ISO 8601 timestamps');
  }
  if (endMs <= startMs) {
    throw new Error('endsAt must be after startsAt');
  }

  const now = new Date().toISOString();
  return {
    id: existingId ?? randomUUID(),
    calendarId,
    title,
    description: input.description ? String(input.description) : '',
    location: input.location ? String(input.location) : '',
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    timezone: input.timezone ? String(input.timezone) : null,
    allDay: Boolean(input.allDay),
    rrule: input.rrule ? String(input.rrule).trim() : null,
    recurrenceId: input.recurrenceId ? String(input.recurrenceId) : null,
    source: input.source ? String(input.source) : 'local',
    remoteHref: input.remote?.href ? String(input.remote.href) : null,
    remoteEtag: input.remote?.etag ? String(input.remote.etag) : null,
    updatedAt: now,
  };
}

/** @param {object} input */
export function createEvent(input) {
  const event = normalizeEventInput(input);
  getCalendarDb()
    .prepare(
      `INSERT INTO events (
        id, calendar_id, title, description, location, starts_at, ends_at, timezone,
        all_day, rrule, recurrence_id, source, remote_href, remote_etag, updated_at
      ) VALUES (
        @id, @calendarId, @title, @description, @location, @startsAt, @endsAt, @timezone,
        @allDay, @rrule, @recurrenceId, @source, @remoteHref, @remoteEtag, @updatedAt
      )`,
    )
    .run({
      ...event,
      allDay: event.allDay ? 1 : 0,
    });
  return getEventById(event.id);
}

/** @param {string} id @param {object} input */
export function updateEvent(id, input) {
  const database = getCalendarDb();
  const existing = database.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('Event not found');
  }

  const merged = {
    title: input.title ?? existing.title,
    calendarId: input.calendarId ?? existing.calendar_id,
    description: input.description ?? existing.description,
    location: input.location ?? existing.location,
    startsAt: input.startsAt ?? existing.starts_at,
    endsAt: input.endsAt ?? existing.ends_at,
    timezone: input.timezone ?? existing.timezone,
    allDay: input.allDay ?? Boolean(existing.all_day),
    rrule: input.rrule ?? existing.rrule,
    recurrenceId: input.recurrenceId ?? existing.recurrence_id,
    source: input.source ?? existing.source,
    remote: input.remote ?? {
      href: existing.remote_href,
      etag: existing.remote_etag,
    },
  };

  const event = normalizeEventInput(merged, id);
  database
    .prepare(
      `UPDATE events SET
        calendar_id = @calendarId,
        title = @title,
        description = @description,
        location = @location,
        starts_at = @startsAt,
        ends_at = @endsAt,
        timezone = @timezone,
        all_day = @allDay,
        rrule = @rrule,
        recurrence_id = @recurrenceId,
        source = @source,
        remote_href = @remoteHref,
        remote_etag = @remoteEtag,
        updated_at = @updatedAt
      WHERE id = @id`,
    )
    .run({
      ...event,
      allDay: event.allDay ? 1 : 0,
    });

  return getEventById(id);
}

/** @param {string} id */
export function deleteEvent(id) {
  const database = getCalendarDb();
  const result = database.prepare('DELETE FROM events WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Event not found');
  }
  return { ok: true };
}

/** @param {string} id */
export function getEventById(id) {
  const row = getCalendarDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) {
    return null;
  }
  return mapEventRow(row);
}

/**
 * List stored events, optionally filtered by calendar and date range.
 * Expands recurring events when from/to are provided.
 * @param {{ calendarId?: string; from?: string; to?: string; expandRecurrence?: boolean }} [query]
 */
export function listEvents(query = {}) {
  const database = getCalendarDb();
  const clauses = [];
  const params = {};

  if (query.calendarId) {
    clauses.push('calendar_id = @calendarId');
    params.calendarId = query.calendarId;
  }

  if (query.from && query.to && !query.expandRecurrence) {
    clauses.push('starts_at < @to AND ends_at > @from');
    params.from = query.from;
    params.to = query.to;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.prepare(`SELECT * FROM events ${where} ORDER BY starts_at ASC`).all(params);
  const events = rows.map(mapEventRow);

  if (query.from && query.to && query.expandRecurrence !== false) {
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);
    return expandEventsInRange(events, fromDate, toDate);
  }

  return events;
}

/**
 * Events starting within the next N hours (for reminder dispatch).
 * @param {number} hours
 */
export function listUpcomingEvents(hours = 24) {
  const now = new Date();
  const horizon = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const expanded = listEvents({
    from: now.toISOString(),
    to: horizon.toISOString(),
    expandRecurrence: true,
  });

  return expanded
    .filter((event) => {
      const startMs = Date.parse(event.startsAt);
      return startMs >= now.getTime() && startMs <= horizon.getTime();
    })
    .slice(0, 100);
}

/**
 * Upsert an event by remote href (CalDAV sync).
 * @param {object} input
 */
export function upsertRemoteEvent(input) {
  const database = getCalendarDb();
  const href = String(input.remoteHref ?? '').trim();
  if (!href) {
    throw new Error('remoteHref is required');
  }

  const existing = database.prepare('SELECT id FROM events WHERE remote_href = ?').get(href);
  if (existing?.id) {
    return updateEvent(existing.id, input);
  }
  return createEvent({ ...input, source: input.source ?? 'caldav' });
}

/** @param {string} calendarId */
export function deleteEventsByCalendarExceptRemote(calendarId, keepHrefs) {
  const database = getCalendarDb();
  const hrefSet = new Set(keepHrefs);
  const rows = database
    .prepare('SELECT id, remote_href FROM events WHERE calendar_id = ? AND source = ?')
    .all(calendarId, 'caldav');

  for (const row of rows) {
    if (row.remote_href && !hrefSet.has(row.remote_href)) {
      database.prepare('DELETE FROM events WHERE id = ?').run(row.id);
    }
  }
}

/** @param {string} accountId */
export function listCalendarsByAccount(accountId) {
  const rows = getCalendarDb()
    .prepare('SELECT * FROM calendars WHERE account_id = ? ORDER BY name COLLATE NOCASE')
    .all(accountId);
  return rows.map(mapCalendarRow);
}

/** @param {string} accountId @param {string} href */
export function getSyncToken(accountId, href) {
  const row = getCalendarDb()
    .prepare('SELECT sync_token FROM sync_state WHERE account_id = ? AND calendar_href = ?')
    .get(accountId, href);
  return row?.sync_token ?? null;
}

/** @param {string} accountId @param {string} href @param {string | null} token */
export function setSyncToken(accountId, href, token) {
  getCalendarDb()
    .prepare(
      `INSERT INTO sync_state (account_id, calendar_href, sync_token)
       VALUES (?, ?, ?)
       ON CONFLICT(account_id, calendar_href) DO UPDATE SET sync_token = excluded.sync_token`,
    )
    .run(accountId, href, token);
}

/** @param {object} row */
export function upsertCalDavAccountRow(row) {
  getCalendarDb()
    .prepare(
      `INSERT INTO caldav_accounts (id, label, url, username, secret_ref, last_sync_at, created_at, updated_at)
       VALUES (@id, @label, @url, @username, @secretRef, @lastSyncAt, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         url = excluded.url,
         username = excluded.username,
         secret_ref = excluded.secret_ref,
         last_sync_at = excluded.last_sync_at,
         updated_at = excluded.updated_at`,
    )
    .run(row);
}

/** List CalDAV accounts (without secrets). */
export function listCalDavAccountRows() {
  const rows = getCalendarDb()
    .prepare('SELECT id, label, url, username, secret_ref, last_sync_at, created_at, updated_at FROM caldav_accounts ORDER BY label')
    .all();
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    url: row.url,
    username: row.username,
    secretRef: row.secret_ref,
    lastSyncAt: row.last_sync_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** @param {string} id */
export function getCalDavAccountRow(id) {
  const row = getCalendarDb()
    .prepare('SELECT id, label, url, username, secret_ref, last_sync_at, created_at, updated_at FROM caldav_accounts WHERE id = ?')
    .get(id);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    username: row.username,
    secretRef: row.secret_ref,
    lastSyncAt: row.last_sync_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @param {string} id */
export function deleteCalDavAccountRow(id) {
  const database = getCalendarDb();
  const result = database.prepare('DELETE FROM caldav_accounts WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('CalDAV account not found');
  }
  database.prepare('DELETE FROM sync_state WHERE account_id = ?').run(id);
  database.prepare('DELETE FROM calendars WHERE account_id = ?').run(id);
  return { ok: true };
}

/** @param {string} accountId */
export function touchCalDavAccountSync(accountId) {
  const updatedAt = new Date().toISOString();
  getCalendarDb()
    .prepare('UPDATE caldav_accounts SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .run(updatedAt, updatedAt, accountId);
}
