/**
 * waitForServer preflight against ephemeral config+tools ping handlers.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleConfigRequest } from '../../server/config/middleware.js';
import { waitForServer } from '../../src/headless/preflight.ts';

/** Minimal ping-only server for headless preflight tests. */
function createPingServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/tools/ping' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    void handleConfigRequest(req, res, url.pathname);
  });
}

describe('headless preflight', () => {
  let server: http.Server | null = null;
  let baseUrl = '';

  before(async () => {
    server = createPingServer();
    await new Promise<void>((resolve, reject) => {
      server!.listen(0, '127.0.0.1', (err?: Error) => (err ? reject(err) : resolve()));
    });
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('waitForServer succeeds when config and tools ping respond', async () => {
    const ok = await waitForServer({ baseUrl, timeoutSec: 5 });
    assert.equal(ok, true);
  });
});
