/**
 * Calendar reset API — confirmation guard and successful wipe.
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
import { closeCalendarDbForTests, createEvent, listCalendars } from '../../server/calendar/store.js';

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const r = httpRequestNode(
      url,
      {
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
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
let server;
let baseUrl;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-calendar-reset-api-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  ({ server, baseUrl } = await startCalendarServer());
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeCalendarDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('calendar reset API', () => {
  test('POST /api/calendar/reset without confirmed returns 400', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/calendar/reset', {});
    assert.equal(res.status, 400);
    assert.match(res.json.error, /confirmed/i);
  });

  test('POST /api/calendar/reset with confirmed wipes data', async () => {
    const calendarId = listCalendars()[0].id;
    createEvent({
      calendarId,
      title: 'Reset me',
      startsAt: '2026-06-15T10:00:00.000Z',
      endsAt: '2026-06-15T11:00:00.000Z',
    });

    const res = await httpRequest(baseUrl, 'POST', '/api/calendar/reset', { confirmed: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);

    const listRes = await httpRequest(baseUrl, 'GET', '/api/calendar/calendars');
    assert.equal(listRes.json.calendars.length, 1);
    assert.equal(listRes.json.calendars[0].name, 'Personal');
  });
});
