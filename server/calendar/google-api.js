/**
 * Google Calendar API sync for OAuth-linked accounts.
 */

import { google } from 'googleapis';
import { getCalDavAccountRow, createCalendar, getCalendarDb, touchCalDavAccountSync, upsertRemoteEvent } from './store.js';
import { getValidAccessToken } from '../oauth/flow.js';

/**
 * @param {ReturnType<typeof getCalDavAccountRow>} row
 */
async function createGoogleCalendarClient(row) {
  if (!row?.oauthConnectionId) {
    throw new Error('Google Calendar sync requires an OAuth connection');
  }
  const accessToken = await getValidAccessToken(row.oauthConnectionId);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

/**
 * @param {Record<string, unknown>} event
 */
export function mapGoogleEvent(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    title: String(event.summary ?? '(No title)'),
    description: String(event.description ?? ''),
    location: String(event.location ?? ''),
    startsAt: start ? new Date(String(start)).toISOString() : new Date().toISOString(),
    endsAt: end ? new Date(String(end)).toISOString() : new Date().toISOString(),
    allDay,
    rrule: event.recurrence?.[0] ?? undefined,
    remoteHref: String(event.id ?? ''),
    remote: { href: String(event.id ?? ''), etag: String(event.etag ?? '') },
  };
}

/** @param {string} accountId */
export async function syncGoogleCalendarAccount(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('Calendar account not found');
  }

  const calendarApi = await createGoogleCalendarClient(row);
  const lookback = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const lookahead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const listRes = await calendarApi.calendarList.list();
  const remoteCalendars = listRes.data.items ?? [];
  let imported = 0;

  for (const remoteCal of remoteCalendars) {
    const calId = remoteCal.id;
    if (!calId) {
      continue;
    }

    const database = getCalendarDb();
    let localCal = database
      .prepare('SELECT * FROM calendars WHERE account_id = ? AND source = ? AND name = ?')
      .get(accountId, 'google', remoteCal.summary ?? 'Google');

    if (!localCal) {
      const created = createCalendar({
        name: remoteCal.summary ?? 'Google Calendar',
        source: 'google',
        accountId,
        color: remoteCal.backgroundColor ?? '#5b8def',
      });
      localCal = database.prepare('SELECT * FROM calendars WHERE id = ?').get(created.id);
    }

    const eventsRes = await calendarApi.events.list({
      calendarId: calId,
      timeMin: lookback.toISOString(),
      timeMax: lookahead.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const events = eventsRes.data.items ?? [];
    for (const event of events) {
      if (!event.id) {
        continue;
      }
      upsertRemoteEvent({
        ...mapGoogleEvent(event),
        calendarId: localCal.id,
        source: 'google',
      });
      imported += 1;
    }
  }

  touchCalDavAccountSync(accountId);
  return { imported, accountId };
}
