/**
 * waitForServer preflight against ephemeral config+tools ping handlers.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
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
  let tempHome = '';
  let previousMinnowHome: string | undefined;

  before(async () => {
    previousMinnowHome = process.env.MINNOW_HOME;
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'minnow-preflight-'));
    process.env.MINNOW_HOME = tempHome;

    server = createPingServer();
    await new Promise<void>((resolve, reject) => {
      server!.listen(0, '127.0.0.1', (err?: Error) => (err ? reject(err) : resolve()));
    });
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (typeof server?.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
    }
    if (previousMinnowHome === undefined) {
      delete process.env.MINNOW_HOME;
    } else {
      process.env.MINNOW_HOME = previousMinnowHome;
    }
  });

  it('waitForServer succeeds when config and tools ping respond', async () => {
    const ok = await waitForServer({ baseUrl, timeoutSec: 5 });
    assert.equal(ok, true);
  });
});
