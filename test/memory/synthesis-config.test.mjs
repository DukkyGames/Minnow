/**
 * Synthesis config API tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { handleMemoryRequest, initMemoryApi } from '../../server/memory/routes.js';

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = httpRequestNode(
      url,
      {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            json: raw ? JSON.parse(raw) : null,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('synthesis config API', () => {
  /** @type {string} */
  let homeDir;
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let baseUrl;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-synthesis-config-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await initMemoryApi();

    server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const handled = await handleMemoryRequest(req, res, pathname);
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('GET returns default throttle', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/memory/synthesis/config');
    assert.equal(res.status, 200);
    assert.equal(res.json.synthesis.throttleMessagePairs, 4);
  });

  test('PUT updates throttle message pairs', async () => {
    const res = await httpRequest(baseUrl, 'PUT', '/api/memory/synthesis/config', {
      throttleMessagePairs: 1,
      enabled: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.synthesis.throttleMessagePairs, 1);

    const again = await httpRequest(baseUrl, 'GET', '/api/memory/synthesis/config');
    assert.equal(again.json.synthesis.throttleMessagePairs, 1);
  });
});
