/**
 * Serve log tail + follow, and the HTTP routes that expose them.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { handleModelsRequest } from '../../server/models/routes.js';
import { modelsLogDir } from '../../server/models/paths.js';
import {
  MLX_LM_MANAGED_SERVER_ID,
  readServeLogTail,
  readServeLogTailForServe,
  resolveServeLogPath,
  subscribeServeLog,
} from '../../server/models/serve-logs.js';
import { resetServesForTests } from '../../server/models/serve.js';

function httpRequest(baseUrl, method, pathname) {
  return new Promise((resolve, reject) => {
    const req = httpRequestNode(new URL(pathname, baseUrl), { method }, (res) => {
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
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serve log tail', () => {
  /** @type {string} */
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-serve-logs-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await fs.mkdir(modelsLogDir(), { recursive: true });
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('returns null when the run has no log yet', async () => {
    assert.equal(await readServeLogTail('missing-run'), null);
  });

  test('reads the trailing bytes of a log', async () => {
    const runId = 'run-tail';
    const logPath = path.join(modelsLogDir(), `${runId}.log`);
    await fs.writeFile(logPath, 'first line\nsecond line\n', 'utf8');

    const all = await readServeLogTail(runId);
    assert.ok(all);
    assert.match(all.text, /first line/);
    assert.equal(all.size, (await fs.stat(logPath)).size);

    const tail = await readServeLogTail(runId, 1024);
    assert.match(tail.text, /second line/);
  });

  test('follow emits the existing tail, then appended chunks', async () => {
    const runId = 'run-follow';
    const logPath = path.join(modelsLogDir(), `${runId}.log`);
    await fs.writeFile(logPath, 'boot\n', 'utf8');

    /** @type {Array<{ text: string, initial?: boolean }>} */
    const events = [];
    const done = new Promise((resolve) => {
      const unsub = subscribeServeLog(runId, (event) => {
        events.push(event);
        if (events.length === 1) {
          void fs.appendFile(logPath, 'loading 50.00 %\n', 'utf8');
          return;
        }
        unsub();
        resolve(undefined);
      });
    });

    await done;
    assert.equal(events[0].initial, true);
    assert.match(events[0].text, /boot/);
    assert.match(events[1].text, /loading 50\.00 %/);
    assert.ok(!events[1].text.includes('boot'), 'follow-up chunks are deltas, not the whole file');
  });

  test('MLX serves resolve to the managed mlx-lm server log', async () => {
    const mlxLogPath = resolveServeLogPath({ runtime: 'mlx-lm', runId: null });
    assert.ok(mlxLogPath?.includes('mlx-lm.log'));
    await fs.mkdir(path.dirname(mlxLogPath), { recursive: true });
    await fs.writeFile(mlxLogPath, 'mlx server boot\n', 'utf8');

    const tail = await readServeLogTailForServe({ runtime: 'mlx-lm' });
    assert.ok(tail);
    assert.match(tail.text, /mlx server boot/);
    assert.equal(tail.size, (await fs.stat(mlxLogPath)).size);
    assert.equal(resolveServeLogPath({ runtime: 'llama-cpp' }), null);
    assert.equal(MLX_LM_MANAGED_SERVER_ID, 'mlx-lm');
  });
});

describe('serve log routes', () => {
  /** @type {string} */
  let homeDir;
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let baseUrl;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-serve-routes-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await resetServesForTests();

    server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const handled = await handleModelsRequest(req, res, pathname);
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('single-serve GET 404s for an unknown id', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/models/serve/00000000-0000-4000-8000-000000000000',
    );
    assert.equal(res.status, 404);
  });

  test('single-serve GET rejects a malformed id', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/models/serve/not-a-uuid');
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Invalid/i);
  });

  test('log route 404s for an unknown serve', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/models/serve/00000000-0000-4000-8000-000000000000/logs',
    );
    assert.equal(res.status, 404);
  });
});
