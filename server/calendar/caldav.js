/**
 * CalDAV account CRUD and bidirectional sync (tsdav client).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDAVClient, fetchCalendarObjects, fetchCalendars } from 'tsdav';
import {
  decryptSecretPayload,
  encryptSecretPayload,
  isEncryptedSecretPayload,
  readEncryptedJsonFile,
  writeEncryptedJsonFile,
} from '../security/secret-box.js';
import { buildEventIcal, parseIcsContent } from './ics.js';
import { assertResolvablePublicHost, validateCaldavUrl } from './caldav-ssrf.js';
import { caldavSecretPath } from './paths.js';
import {
  createCalendar,
  deleteEventsByCalendarExceptRemote,
  getCalDavAccountRow,
  deleteCalDavAccountRow,
  listCalDavAccountRows,
  touchCalDavAccountSync,
  upsertCalDavAccountRow,
  upsertRemoteEvent,
  getCalendarDb,
  listEvents,
} from './store.js';
import { pushEventToRemote, deleteRemoteEvent } from './caldav-writeback.js';

/** @param {string} accountId */
async function readAccountPassword(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('CalDAV account not found');
  }
  const envelope = await readEncryptedJsonFile(caldavSecretPath(accountId));
  if (!isEncryptedSecretPayload(envelope)) {
    throw new Error('CalDAV credentials are missing or corrupt');
  }
  return decryptSecretPayload(envelope);
}

/**
 * @param {{ label: string; url: string; username: string; password: string; allowLocalHttp?: boolean }} input
 */
export async function createCalDavAccount(input) {
  const label = String(input.label ?? '').trim();
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  if (!label || !username || !password) {
    throw new Error('label, username, and password are required');
  }

  const url = await validateCaldavUrl(input.url, { allowLocalHttp: input.allowLocalHttp });
  const parsed = new URL(url);
  await assertResolvablePublicHost(parsed.hostname);

  const id = randomUUID();
  const now = new Date().toISOString();
  const secretRef = caldavSecretPath(id);
  await fs.mkdir(path.dirname(secretRef), { recursive: true });
  await writeEncryptedJsonFile(secretRef, await encryptSecretPayload(password));

  upsertCalDavAccountRow({
    id,
    label,
    url,
    username,
    secretRef,
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
    syncBackend: 'caldav',
    oauthConnectionId: null,
    provider: null,
  });

  return getCalDavAccountRow(id);
}

/** List CalDAV accounts without passwords. */
export function listCalDavAccounts() {
  return listCalDavAccountRows();
}

/** @param {string} accountId */
export async function deleteCalDavAccount(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('CalDAV account not found');
  }
  try {
    await fs.unlink(caldavSecretPath(accountId));
  } catch {
    /* ignore missing secret file */
  }
  return deleteCalDavAccountRow(accountId);
}

/**
 * @param {string} accountId
 */
async function createDavClient(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('CalDAV account not found');
  }
  const password = await readAccountPassword(accountId);
  return createDAVClient({
    serverUrl: row.url,
    credentials: {
      username: row.username,
      password,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

/**
 * Pull remote calendars and events into local SQLite.
 * @param {string} accountId
 */
export async function syncCalDavAccount(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('CalDAV account not found');
  }

  const client = await createDavClient(accountId);
  const remoteCalendars = await fetchCalendars({ client });

  const lookback = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const lookahead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  let imported = 0;

  for (const remoteCal of remoteCalendars) {
    const href = remoteCal.url;
    if (!href) {
      continue;
    }

    const database = getCalendarDb();
    let localCal = database
      .prepare('SELECT * FROM calendars WHERE account_id = ? AND source = ? AND name = ?')
      .get(accountId, 'caldav', remoteCal.displayName ?? 'CalDAV');

    if (!localCal) {
      const created = createCalendar({
        name: remoteCal.displayName ?? 'CalDAV',
        source: 'caldav',
        accountId,
        color: '#5b8def',
      });
      localCal = database.prepare('SELECT * FROM calendars WHERE id = ?').get(created.id);
    }

    const objects = await fetchCalendarObjects({
      calendar: remoteCal,
      timeRange: {
        start: lookback.toISOString(),
        end: lookahead.toISOString(),
      },
    });

    const seenHrefs = [];
    for (const object of objects) {
      if (!object.data || !object.url) {
        continue;
      }
      seenHrefs.push(object.url);
      const parsedEvents = parseIcsContent(object.data);
      for (const parsed of parsedEvents) {
        upsertRemoteEvent({
          ...parsed,
          calendarId: localCal.id,
          source: 'caldav',
          remoteHref: object.url,
          remote: { href: object.url, etag: object.etag },
        });
        imported += 1;
      }
    }

    deleteEventsByCalendarExceptRemote(localCal.id, seenHrefs);
  }

  touchCalDavAccountSync(accountId);
  return { ok: true, imported };
}

/**
 * Push local changes that originated locally to CalDAV.
 * @param {string} accountId
 */
export async function writeBackLocalChanges(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('CalDAV account not found');
  }

  const client = await createDavClient(accountId);
  const remoteCalendars = await fetchCalendars({ client });
  const defaultRemote = remoteCalendars[0];
  if (!defaultRemote) {
    throw new Error('No remote CalDAV calendars found');
  }

  const database = getCalendarDb();
  const localCalendars = database
    .prepare('SELECT id FROM calendars WHERE account_id = ?')
    .all(accountId);

  let pushed = 0;
  for (const cal of localCalendars) {
    const events = listEvents({ calendarId: cal.id, expandRecurrence: false });
    for (const event of events) {
      if (event.source !== 'local' && event.source !== 'agent') {
        continue;
      }
      await pushEventToRemote(client, defaultRemote, event);
      database
        .prepare('UPDATE events SET source = ?, remote_href = ?, updated_at = ? WHERE id = ?')
        .run('caldav', event.remote?.href ?? `${defaultRemote.url}${event.id}.ics`, new Date().toISOString(), event.id);
      pushed += 1;
    }
  }

  return { ok: true, pushed };
}

/** @param {string} accountId @param {string} remoteHref */
export async function deleteCalDavRemoteEvent(accountId, remoteHref) {
  const client = await createDavClient(accountId);
  const remoteCalendars = await fetchCalendars({ client });
  const defaultRemote = remoteCalendars[0];
  if (!defaultRemote) {
    throw new Error('No remote CalDAV calendars found');
  }
  await deleteRemoteEvent(client, defaultRemote, remoteHref);
  return { ok: true };
}
