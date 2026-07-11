/**
 * ICS feed URL import — SSRF guard and API route.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { request as httpRequestNode } from 'node:http';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { createCalendarMiddleware } from '../../server/calendar/middleware.js';
import {
  closeCalendarDbForTests,
  listCalendars,
  listEvents,
} from '../../server/calendar/store.js';
import { fetchIcsContentFromUrl, importIcsFromUrl } from '../../server/calendar/ics-feed.js';

const FIXTURE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar//EN
X-WR-CALNAME:Work Calendar
BEGIN:VEVENT
UID:feed-test-event-1
SUMMARY:Imported meeting
DTSTART:20260701T150000Z
DTEND:20260701T160000Z
END:VEVENT
END:VCALENDAR`;

const PUBLIC_FEED_URL = 'https://calendar.google.com/calendar/ical/test/basic.ics';

function mockFetchResponse(body) {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name === 'content-length' ? String(Buffer.byteLength(body)) : null),
    },
    text: async () => body,
  });
}

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const r = httpRequestNode(
      url,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode, body: raw, json });
        });
      },
    );
    r.on('error', reject);
    if (payload) {
      r.write(payload);
    }
    r.end();
  });
}

async function startCalendarServer() {
  const middleware = createCalendarMiddleware();
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** @type {string} */
let homeDir;
let apiServer;
let apiBaseUrl;
/** @type {typeof fetch | null} */
let originalFetch = null;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-calendar-ics-feed-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  ({ server: apiServer, baseUrl: apiBaseUrl } = await startCalendarServer());
});

after(async () => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  await new Promise((resolve) => apiServer.close(resolve));
  closeCalendarDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('calendar ics feed', () => {
  test('fetchIcsContentFromUrl downloads and validates ICS text', async () => {
    const content = await fetchIcsContentFromUrl(PUBLIC_FEED_URL, {
      fetchFn: mockFetchResponse(FIXTURE_ICS),
    });
    assert.match(content, /BEGIN:VCALENDAR/);
    assert.match(content, /Imported meeting/);
  });

  test('fetchIcsContentFromUrl rejects private targets', async () => {
    await assert.rejects(
      () => fetchIcsContentFromUrl('https://192.168.1.10/feed.ics'),
      /private\/internal addresses/,
    );
  });

  test('importIcsFromUrl creates a calendar and imports events', async () => {
    const result = await importIcsFromUrl({
      url: PUBLIC_FEED_URL,
      calendarName: 'Google',
      fetchFn: mockFetchResponse(FIXTURE_ICS),
    });
    assert.equal(result.imported, 1);
    assert.ok(result.calendarId);
    const calendars = listCalendars();
    const imported = calendars.find((row) => row.id === result.calendarId);
    assert.ok(imported);
    assert.equal(imported.name, 'Google');
    const events = listEvents({
      calendarId: result.calendarId,
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'Imported meeting');
  });

  test('POST /api/calendar/import/ics-url imports from a remote feed', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchResponse(FIXTURE_ICS);
    try {
      const res = await httpRequest(apiBaseUrl, 'POST', '/api/calendar/import/ics-url', {
        feed: {
          url: PUBLIC_FEED_URL,
          calendarName: 'Feed via API',
        },
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.imported, 1);
      assert.ok(res.json.calendarId);
      const calendar = listCalendars().find((row) => row.id === res.json.calendarId);
      assert.ok(calendar);
      assert.equal(calendar.name, 'Feed via API');
    } finally {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }
  });
});
