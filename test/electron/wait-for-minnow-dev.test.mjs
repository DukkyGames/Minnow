import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { initNetworkAccess } from '../../server/network/access.js';
import { createAuthMiddleware } from '../../server/runtime/auth-middleware.js';
import { getSessionToken, resetSessionTokenCache } from '../../server/runtime/session-token.js';
import { waitForMinnowDev } from '../../scripts/wait-for-minnow-dev.mjs';

let homeDir;
/** @type {import('node:http').Server | null} */
let server = null;

function setTestHome() {
  resetMinnowHomeCache();
  resetSessionTokenCache();
  homeDir = path.join(
    process.cwd(),
    'test',
    'tmp',
    `wait-minnow-dev-${process.pid}-${Date.now()}`,
  );
  process.env.MINNOW_HOME = homeDir;
  initNetworkAccess({});
}

async function rmTestHome() {
  resetMinnowHomeCache();
  resetSessionTokenCache();
  delete process.env.MINNOW_HOME;
  try {
    await fs.rm(homeDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function startAuthPingServer(port) {
  const auth = createAuthMiddleware();
  await new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      auth(req, res, () => {
        if (req.url === '/api/config/ping' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

describe('waitForMinnowDev', () => {
  beforeEach(() => {
    setTestHome();
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => {
        server = null;
        resolve();
      });
    });
    await rmTestHome();
  });

  test('resolves when /api/config/ping accepts the session token', async () => {
    const token = getSessionToken();
    await startAuthPingServer(0);
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

    const result = await waitForMinnowDev({
      preferredPort: port,
      token,
      timeoutMs: 5_000,
      intervalMs: 50,
    });

    assert.equal(result.port, port);
    assert.match(result.origin, new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${port}$`));
  });

  test('keeps waiting when the session token is missing', async () => {
    await startAuthPingServer(0);
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

    await assert.rejects(
      () =>
        waitForMinnowDev({
          preferredPort: port,
          token: '',
          timeoutMs: 400,
          intervalMs: 50,
        }),
      /Timed out waiting for Minnow dev server/,
    );
  });
});
