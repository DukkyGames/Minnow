/**
 * Phase 0 session sync tests (MIN-357): version guard (PUT + PATCH) + driver lease.
 * Adapted for SQLite sessions store (default) after the JSON→SQLite cutover.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleConfigRequest } from '../../server/config/middleware.js';
import { handleSessionRequest } from '../../server/session/middleware.js';
import {
  resetSessionRevStoreForTests,
} from '../../server/session/rev-store.js';
import { resetSessionSseForTests } from '../../server/session/sse.js';
import { resetBoardDriverLeaseForTests } from '../../server/session/lease.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  httpRequest,
  readFixture,
  setTestHome,
  rmTestHome,
} from '../config/test-helpers.js';

/** @type {Record<string, unknown>} */
let defaultSessionFixture;

function createPhase0TestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleSessionRequest(req, res, url.pathname).then((sessionHandled) => {
      if (sessionHandled) return;
      void handleConfigRequest(req, res, url.pathname).then((configHandled) => {
        if (!configHandled) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });
  });
}

function httpRequestWithHeaders(baseUrl, method, pathname, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({
            status: res.statusCode,
            json,
            text,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('session phase 0 (MIN-357)', () => {
  /** @type {string | undefined} */
  let home;
  /** @type {http.Server | undefined} */
  let server;
  /** @type {string | undefined} */
  let baseUrl;

  before(async () => {
    home = setTestHome(process.env, 'minnow-session-phase0');
    defaultSessionFixture = JSON.parse(await readFixture('expected-sessions-state.json'));
    resetSessionRevStoreForTests();
    resetSessionSseForTests();
    resetBoardDriverLeaseForTests();
    server = createPhase0TestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    resetSessionRevStoreForTests();
    resetBoardDriverLeaseForTests();
  });

  after(async () => {
    resetSessionSseForTests();
    resetBoardDriverLeaseForTests();
    resetSessionRevStoreForTests();
    // Close SQLite before deleting the temp home (Windows EBUSY otherwise).
    closeSessionsDb();
    await new Promise((resolve) => server?.close(resolve));
    if (home) await rmTestHome(home);
  });

  test('PUT /api/config/sessions rejects stale If-Match with 409', async () => {
    const put1 = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put1.status, 200);
    const rev1 = put1.json?.rev;
    assert.ok(typeof rev1 === 'number' && rev1 > 0);

    const put2 = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', {
      ...defaultSessionFixture,
      chats: defaultSessionFixture.chats.map((c, i) =>
        i === 0 ? { ...c, name: 'Renamed chat' } : c,
      ),
    });
    assert.equal(put2.status, 200);
    const rev2 = put2.json?.rev;
    assert.ok(rev2 > rev1);

    const stale = await httpRequestWithHeaders(
      baseUrl,
      'PUT',
      '/api/config/sessions',
      defaultSessionFixture,
      { 'If-Match': String(rev1) },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.json?.error, 'Session state revision conflict');
    assert.ok(stale.json?.rev >= rev2);
    assert.equal(stale.headers['x-session-rev'], String(stale.json.rev));
  });

  test('PATCH /api/config/sessions rejects stale If-Match and expectedRev with 409', async () => {
    const put1 = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put1.status, 200);
    const rev1 = put1.json?.rev;
    assert.ok(typeof rev1 === 'number' && rev1 > 0);

    const firstChat = defaultSessionFixture.chats[0];
    const patchOk = await httpRequestWithHeaders(
      baseUrl,
      'PATCH',
      '/api/config/sessions',
      {
        baseVersion: defaultSessionFixture.version ?? 6,
        expectedRev: rev1,
        chats: [{ ...firstChat, name: 'Patched name' }],
      },
      { 'If-Match': String(rev1) },
    );
    assert.equal(patchOk.status, 200);
    const rev2 = patchOk.json?.rev;
    assert.ok(typeof rev2 === 'number' && rev2 > rev1);
    assert.equal(patchOk.headers['x-session-rev'], String(rev2));

    const staleHeader = await httpRequestWithHeaders(
      baseUrl,
      'PATCH',
      '/api/config/sessions',
      {
        baseVersion: defaultSessionFixture.version ?? 6,
        chats: [{ ...firstChat, name: 'Stale header' }],
      },
      { 'If-Match': String(rev1) },
    );
    assert.equal(staleHeader.status, 409);
    assert.equal(staleHeader.json?.error, 'Session state revision conflict');

    const staleBody = await httpRequest(
      baseUrl,
      'PATCH',
      '/api/config/sessions',
      {
        baseVersion: defaultSessionFixture.version ?? 6,
        expectedRev: rev1,
        chats: [{ ...firstChat, name: 'Stale body' }],
      },
    );
    assert.equal(staleBody.status, 409);
    assert.ok(staleBody.json?.rev >= rev2);
  });

  test('GET /api/config/sessions returns X-Session-Rev after seed', async () => {
    await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    const get = await httpRequestWithHeaders(baseUrl, 'GET', '/api/config/sessions');
    assert.equal(get.status, 200);
    const revHeader = get.headers['x-session-rev'];
    assert.ok(revHeader);
    assert.ok(Number.parseInt(String(revHeader), 10) > 0);
  });

  test('driver lease: only one client holds claim concurrently', async () => {
    const claimA = await httpRequest(baseUrl, 'POST', '/api/session/lease', {
      driverId: 'driver-a',
      action: 'claim',
      label: 'Device A',
    });
    assert.equal(claimA.status, 200);
    assert.equal(claimA.json?.held, true);

    const claimB = await httpRequest(baseUrl, 'POST', '/api/session/lease', {
      driverId: 'driver-b',
      action: 'claim',
      label: 'Device B',
    });
    assert.equal(claimB.status, 200);
    assert.equal(claimB.json?.held, false);
    assert.equal(claimB.json?.holder?.driverId, 'driver-a');

    const renewB = await httpRequest(baseUrl, 'POST', '/api/session/lease', {
      driverId: 'driver-b',
      action: 'renew',
    });
    assert.equal(renewB.status, 200);
    assert.equal(renewB.json?.held, false);

    await httpRequest(baseUrl, 'POST', '/api/session/lease', {
      driverId: 'driver-a',
      action: 'release',
    });

    const claimB2 = await httpRequest(baseUrl, 'POST', '/api/session/lease', {
      driverId: 'driver-b',
      action: 'claim',
      label: 'Device B',
    });
    assert.equal(claimB2.status, 200);
    assert.equal(claimB2.json?.held, true);
  });
});
