/**
 * Calendar REST API middleware (/api/calendar/*).
 */

import { ensureMinnowLayout } from '../config/home.js';
import {
  createCalDavAccount,
  deleteCalDavAccount,
  listCalDavAccounts,
  syncCalDavAccount,
  writeBackLocalChanges,
} from './caldav.js';
import { exportCalendarIcs, importIcsToCalendar } from './ics.js';
import { listUpcomingEvents } from './store.js';
import {
  createCalendar,
  createEvent,
  deleteEvent,
  getEventById,
  listCalendars,
  listEvents,
  updateCalendar,
  updateEvent,
} from './store.js';
import { findFreeTimeSlots } from './recurrence.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Upload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @param {string} url */
function parseQuery(url) {
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams;
}

export function createCalendarMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/calendar')) {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      await ensureMinnowLayout();

      if (url === '/api/calendar/ping' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url === '/api/calendar/calendars' && req.method === 'GET') {
        sendJson(res, 200, { calendars: listCalendars() });
        return;
      }

      if (url === '/api/calendar/calendars' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const calendar = createCalendar(body?.calendar ?? body);
        sendJson(res, 201, { calendar });
        return;
      }

      if (url === '/api/calendar/events' && req.method === 'GET') {
        const params = parseQuery(req.url ?? '');
        const events = listEvents({
          calendarId: params.get('calendarId') ?? undefined,
          from: params.get('from') ?? undefined,
          to: params.get('to') ?? undefined,
          expandRecurrence: params.get('expand') !== 'false',
        });
        sendJson(res, 200, { events });
        return;
      }

      if (url === '/api/calendar/events' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const event = createEvent(body?.event ?? body);
        sendJson(res, 201, { event });
        return;
      }

      const eventMatch = url.match(/^\/api\/calendar\/events\/([^/]+)$/);
      if (eventMatch) {
        const eventId = decodeURIComponent(eventMatch[1]);
        if (req.method === 'GET') {
          const event = getEventById(eventId);
          if (!event) {
            sendJson(res, 404, { error: 'Event not found' });
            return;
          }
          sendJson(res, 200, { event });
          return;
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const event = updateEvent(eventId, body?.event ?? body);
          sendJson(res, 200, { event });
          return;
        }
        if (req.method === 'DELETE') {
          await deleteEvent(eventId);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      if (url === '/api/calendar/import/ics' && req.method === 'POST') {
        const params = parseQuery(req.url ?? '');
        const calendarId = params.get('calendarId');
        if (!calendarId) {
          sendJson(res, 400, { error: 'calendarId query parameter is required' });
          return;
        }
        const content = await readRawBody(req);
        const events = importIcsToCalendar(calendarId, content);
        sendJson(res, 200, { imported: events.length, events });
        return;
      }

      if (url === '/api/calendar/export/ics' && req.method === 'GET') {
        const params = parseQuery(req.url ?? '');
        const calendarId = params.get('calendarId');
        if (!calendarId) {
          sendJson(res, 400, { error: 'calendarId query parameter is required' });
          return;
        }
        const ics = exportCalendarIcs(calendarId);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
        res.end(ics);
        return;
      }

      if (url === '/api/calendar/upcoming' && req.method === 'GET') {
        const params = parseQuery(req.url ?? '');
        const hours = Number(params.get('hours') ?? '24');
        const events = listUpcomingEvents(Number.isFinite(hours) ? hours : 24);
        sendJson(res, 200, { events });
        return;
      }

      if (url === '/api/calendar/free-time' && req.method === 'GET') {
        const params = parseQuery(req.url ?? '');
        const date = params.get('date');
        const minMinutes = Number(params.get('minMinutes') ?? '30');
        if (!date) {
          sendJson(res, 400, { error: 'date query parameter is required (YYYY-MM-DD)' });
          return;
        }
        const dayStart = new Date(`${date}T00:00:00.000Z`);
        const dayEnd = new Date(`${date}T23:59:59.999Z`);
        const events = listEvents({
          calendarId: params.get('calendarId') ?? undefined,
          from: dayStart.toISOString(),
          to: dayEnd.toISOString(),
          expandRecurrence: true,
        });
        const slots = findFreeTimeSlots(events, dayStart, dayEnd, minMinutes);
        sendJson(res, 200, { slots });
        return;
      }

      if (url === '/api/calendar/caldav/accounts' && req.method === 'GET') {
        sendJson(res, 200, { accounts: listCalDavAccounts() });
        return;
      }

      if (url === '/api/calendar/caldav/accounts' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = await createCalDavAccount(body?.account ?? body);
        sendJson(res, 201, { account });
        return;
      }

      const caldavAccountMatch = url.match(/^\/api\/calendar\/caldav\/accounts\/([^/]+)$/);
      if (caldavAccountMatch && req.method === 'DELETE') {
        const accountId = decodeURIComponent(caldavAccountMatch[1]);
        await deleteCalDavAccount(accountId);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url === '/api/calendar/caldav/sync' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const accountId = String(body?.accountId ?? '').trim();
        if (!accountId) {
          sendJson(res, 400, { error: 'accountId is required' });
          return;
        }
        const pull = await syncCalDavAccount(accountId);
        const push = await writeBackLocalChanges(accountId);
        sendJson(res, 200, { ...pull, ...push });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : 400;
      sendJson(res, status, { error: message });
    }
  };
}
