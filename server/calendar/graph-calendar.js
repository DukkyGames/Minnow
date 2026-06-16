/**
 * Microsoft Graph calendar sync for OAuth-linked accounts.
 */

import { getCalDavAccountRow, createCalendar, getCalendarDb, touchCalDavAccountSync, upsertRemoteEvent } from './store.js';
import { getValidAccessToken } from '../oauth/flow.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * @param {ReturnType<typeof getCalDavAccountRow>} row
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function graphFetch(row, path, init = {}) {
  if (!row?.oauthConnectionId) {
    throw new Error('Microsoft calendar sync requires an OAuth connection');
  }
  const accessToken = await getValidAccessToken(row.oauthConnectionId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error?.message || res.statusText;
    throw new Error(`Microsoft Graph calendar error: ${detail}`);
  }
  return data;
}

/**
 * @param {Record<string, unknown>} event
 */
export function mapGraphCalendarEvent(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  const allDay = Boolean(event.isAllDay);
  return {
    title: String(event.subject ?? '(No title)'),
    description: String(event.body?.content ?? ''),
    location: String(event.location?.displayName ?? ''),
    startsAt: start ? new Date(String(start)).toISOString() : new Date().toISOString(),
    endsAt: end ? new Date(String(end)).toISOString() : new Date().toISOString(),
    allDay,
    remoteHref: String(event.id ?? ''),
    remote: { href: String(event.id ?? ''), etag: String(event['@odata.etag'] ?? '') },
  };
}

/** @param {string} accountId */
export async function syncGraphCalendarAccount(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('Calendar account not found');
  }

  const lookback = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const lookahead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const filter = `start/dateTime ge '${lookback.toISOString()}' and end/dateTime le '${lookahead.toISOString()}'`;

  const data = await graphFetch(
    row,
    `/me/calendar/events?$filter=${encodeURIComponent(filter)}&$top=250&$orderby=start/dateTime`,
  );
  const events = Array.isArray(data.value) ? data.value : [];

  const database = getCalendarDb();
  let localCal = database
    .prepare('SELECT * FROM calendars WHERE account_id = ? AND source = ?')
    .get(accountId, 'microsoft');

  if (!localCal) {
    const created = createCalendar({
      name: row.label || 'Outlook Calendar',
      source: 'microsoft',
      accountId,
      color: '#5b8def',
    });
    localCal = database.prepare('SELECT * FROM calendars WHERE id = ?').get(created.id);
  }

  let imported = 0;
  for (const event of events) {
    if (!event.id) {
      continue;
    }
    upsertRemoteEvent({
      ...mapGraphCalendarEvent(event),
      calendarId: localCal.id,
      source: 'microsoft',
    });
    imported += 1;
  }

  touchCalDavAccountSync(accountId);
  return { imported, accountId };
}
