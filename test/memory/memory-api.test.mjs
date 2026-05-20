/**
 * Memory API integration tests (Step 16) — fixed UUIDs, static expectations.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetSpeedChatHomeCache } from '../../server/config/home.js';
import { handleMemoryRequest, initMemoryApi } from '../../server/memory/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ID = '11111111-1111-1111-1111-111111111111';
const FIXTURE_ID_B = '22222222-2222-2222-2222-222222222222';

import { request as httpRequestNode } from 'node:http';

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const r = httpRequestNode(
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
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function startMemoryServer(homeDir) {
  process.env.SPEEDCHAT_HOME = homeDir;
  resetSpeedChatHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
  await fs.mkdir(homeDir, { recursive: true });
  await initMemoryApi();

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const handled = await handleMemoryRequest(req, res, pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('memory API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speedchat-memory-api-'));
    ({ server, baseUrl } = await startMemoryServer(homeDir));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.SPEEDCHAT_HOME;
    resetSpeedChatHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('ping returns ok', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/memory/ping');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  test('create list get update delete lifecycle', async () => {
    const create = await httpRequest(baseUrl, 'POST', '/api/memory/entries', {
      id: FIXTURE_ID,
      title: 'Preferred test command',
      body: 'Always run npm start before API smoke tests.',
      tags: ['testing', 'npm'],
    });
    assert.equal(create.status, 201);
    assert.equal(create.json.entry.id, FIXTURE_ID);

    const list = await httpRequest(baseUrl, 'GET', '/api/memory/entries');
    assert.ok(list.json.entries.some((e) => e.id === FIXTURE_ID));

    const get = await httpRequest(baseUrl, 'GET', `/api/memory/entries/${FIXTURE_ID}`);
    assert.equal(get.status, 200);
    assert.equal(get.json.entry.title, 'Preferred test command');
    assert.match(get.json.body, /npm start/);

    const update = await httpRequest(
      baseUrl,
      'PUT',
      `/api/memory/entries/${FIXTURE_ID}`,
      { title: 'Updated title' },
    );
    assert.equal(update.json.entry.title, 'Updated title');

    const del = await httpRequest(baseUrl, 'DELETE', `/api/memory/entries/${FIXTURE_ID}`);
    assert.equal(del.json.ok, true);

    const gone = await httpRequest(baseUrl, 'GET', `/api/memory/entries/${FIXTURE_ID}`);
    assert.equal(gone.status, 404);
  });

  test('retrieve query matches npm entry', async () => {
    await httpRequest(baseUrl, 'POST', '/api/memory/entries', {
      id: FIXTURE_ID,
      title: 'npm workflow',
      body: 'Use npm start for integration tests.',
      tags: ['npm'],
    });
    await httpRequest(baseUrl, 'POST', '/api/memory/entries', {
      id: FIXTURE_ID_B,
      title: 'Python only',
      body: 'Use poetry for Python projects.',
      tags: ['python'],
    });

    const res = await httpRequest(baseUrl, 'POST', '/api/memory/retrieve', {
      query: 'npm',
    });
    assert.match(res.json.block, /npm workflow/);
    assert.doesNotMatch(res.json.block, /Python only/);
  });

  test('reject oversize body', async () => {
    const big = 'x'.repeat(33 * 1024);
    const res = await httpRequest(baseUrl, 'POST', '/api/memory/entries', {
      title: 'big',
      body: big,
    });
    assert.equal(res.status, 413);
  });

  test('invalid entry id rejected', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/memory/entries/../../../etc/passwd',
    );
    assert.ok(res.status === 400 || res.status === 404);
  });
});
