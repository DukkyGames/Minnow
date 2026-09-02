/**
 * Calendar API client for the Minnow Calendar app.
 */

import { withSessionToken } from '../api/session-token.ts';

export interface CalendarRow {
  id: string;
  name: string;
  color: string;
  source: string;
  accountId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  allDay?: boolean;
  rrule?: string;
  recurrenceId?: string;
  source?: string;
  isOccurrence?: boolean;
  conflict?: boolean;
  updatedAt: string;
}

export interface CalDavAccount {
  id: string;
  label: string;
  url: string;
  username: string;
  lastSyncAt?: string;
  syncBackend?: 'caldav';
}

async function parseJson<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : res.statusText);
  }
  return payload;
}

export async function fetchCalendars(): Promise<CalendarRow[]> {
  const res = await fetch('/api/calendar/calendars');
  const data = await parseJson<{ calendars: CalendarRow[] }>(res);
  return data.calendars;
}

export async function fetchEvents(query: {
  calendarId?: string;
  from: string;
  to: string;
}): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.calendarId) {
    params.set('calendarId', query.calendarId);
  }
  const res = await fetch(`/api/calendar/events?${params.toString()}`);
  const data = await parseJson<{ events: CalendarEvent[] }>(res);
  return data.events;
}

export async function createCalendarEvent(input: Partial<CalendarEvent> & {
  title: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
}): Promise<CalendarEvent> {
  const res = await fetch('/api/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: input }),
  });
  const data = await parseJson<{ event: CalendarEvent }>(res);
  return data.event;
}

export async function updateCalendarEvent(
  id: string,
  input: Partial<CalendarEvent>,
): Promise<CalendarEvent> {
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: input }),
  });
  const data = await parseJson<{ event: CalendarEvent }>(res);
  return data.event;
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJson(res);
}

export async function importIcsFile(calendarId: string, file: File): Promise<number> {
  const res = await fetch(`/api/calendar/import/ics?calendarId=${encodeURIComponent(calendarId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/calendar' },
    body: await file.text(),
  });
  const data = await parseJson<{ imported: number }>(res);
  return data.imported;
}

export async function importIcsFromUrl(input: {
  url: string;
  calendarId?: string;
  calendarName?: string;
}): Promise<{ imported: number; calendarId: string; calendar: CalendarRow | null }> {
  const res = await fetch('/api/calendar/import/ics-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feed: input }),
  });
  const data = await parseJson<{
    imported: number;
    calendarId: string;
    calendar: CalendarRow | null;
  }>(res);
  return data;
}

export function exportIcsUrl(calendarId: string): string {
  return withSessionToken(`/api/calendar/export/ics?calendarId=${encodeURIComponent(calendarId)}`);
}

export async function fetchCalDavAccounts(): Promise<CalDavAccount[]> {
  const res = await fetch('/api/calendar/caldav/accounts');
  const data = await parseJson<{ accounts: CalDavAccount[] }>(res);
  return data.accounts;
}

export async function createCalDavAccount(input: {
  label: string;
  url: string;
  username: string;
  password: string;
}): Promise<CalDavAccount> {
  const res = await fetch('/api/calendar/caldav/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: input }),
  });
  const data = await parseJson<{ account: CalDavAccount }>(res);
  return data.account;
}

export async function syncCalDav(accountId: string): Promise<void> {
  const res = await fetch('/api/calendar/caldav/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  await parseJson(res);
}

export async function deleteCalDavAccount(id: string): Promise<void> {
  const res = await fetch(`/api/calendar/caldav/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJson(res);
}

export async function createCalendar(input: {
  name: string;
  color?: string;
}): Promise<CalendarRow> {
  const res = await fetch('/api/calendar/calendars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calendar: input }),
  });
  const data = await parseJson<{ calendar: CalendarRow }>(res);
  return data.calendar;
}

export async function updateCalendar(
  id: string,
  input: { name?: string; color?: string },
): Promise<CalendarRow> {
  const res = await fetch(`/api/calendar/calendars/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calendar: input }),
  });
  const data = await parseJson<{ calendar: CalendarRow }>(res);
  return data.calendar;
}

export async function deleteCalendar(id: string): Promise<void> {
  const res = await fetch(`/api/calendar/calendars/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJson(res);
}

export async function resetCalendar(): Promise<void> {
  const res = await fetch('/api/calendar/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed: true }),
  });
  await parseJson(res);
}
