/**
 * Models API integration tests — ping, validation errors, installed/runtimes lists.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { handleModelsRequest } from '../../server/models/routes.js';
import { resetDownloadsForTests } from '../../server/models/download.js';
import { resetServesForTests } from '../../server/models/serve.js';

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

async function startModelsServer(homeDir) {
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await resetDownloadsForTests();
  await resetServesForTests();

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const handled = await handleModelsRequest(req, res, pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('models API', () => {
  /** @type {string} */
  let homeDir;
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let baseUrl;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-models-api-'));
    ({ server, baseUrl } = await startModelsServer(homeDir));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('ping returns ok', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/models/ping');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  test('downloads list starts empty', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/models/downloads');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.jobs, []);
  });

  test('installed returns empty artifacts', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/models/installed');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.artifacts, []);
    assert.ok(Array.isArray(res.json.downloads));
  });

  test('runtimes returns detection shape', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/models/runtimes');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.llamaCpp.available, 'boolean');
    assert.equal(typeof res.json.ollama.serving, 'boolean');
    assert.equal(typeof res.json.lmStudio.available, 'boolean');
  });

  test('serve list starts empty', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/models/serve');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.serves, []);
  });

  test('download rejects invalid repoId', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/models/download', {
      repoId: 'bad;rm',
      quant: 'Q4_K_M',
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Invalid repoId/);
  });

  test('serve rejects missing model file', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/models/serve', {
      modelPath: '/tmp/does-not-exist-model.gguf',
      runtime: 'llama-cpp',
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /not found/i);
  });

  test('cancel rejects invalid job id format', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/models/download/not-a-uuid/cancel');
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Invalid job id/);
  });
});
