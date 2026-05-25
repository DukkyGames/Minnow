import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { writeConfigJson } from '../../server/config/store.js';
import { handlePluginsRequest } from '../../server/tools/middleware.js';
import { reloadPlugins } from '../../server/tools/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '../fixtures/plugin-tools');
const EXPECTED_TOOL = 'plugin__echo__ping';

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
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
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('plugins API', () => {
  let homeDir;
  /** @type {import('node:http').Server} */
  let server;
  let baseUrl;

  before(async () => {
    homeDir = path.join(os.tmpdir(), `minnow-plugin-api-${process.pid}`);
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();

    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(path.join(homeDir, 'tools'), { recursive: true });
    await fs.cp(
      path.join(FIXTURE_ROOT, 'echo'),
      path.join(homeDir, 'tools', 'echo'),
      { recursive: true },
    );

    await writeConfigJson('tools.json', {
      enabled: {},
      permissions: { default: {}, perAgent: {}, patterns: [] },
      keys: { braveApiKey: '' },
      plugins: { echo: { enabled: true } },
    });

    await reloadPlugins();

    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      void handlePluginsRequest(req, res, url.pathname).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('GET /api/plugins/ping', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/plugins/ping');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
  });

  test('GET /api/plugins/tools lists echo', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/plugins/tools');
    assert.equal(status, 200);
    const names = (json.tools ?? []).map((t) => t.function?.name);
    assert.ok(names.includes(EXPECTED_TOOL));
  });

  test('POST /api/plugins/scaffold rejects duplicate', async () => {
    const first = await httpRequest(baseUrl, 'POST', '/api/plugins/scaffold', {
      id: 'demo-api',
    });
    assert.equal(first.status, 201);

    const second = await httpRequest(baseUrl, 'POST', '/api/plugins/scaffold', {
      id: 'demo-api',
    });
    assert.equal(second.status, 400);
    assert.match(String(second.json?.error ?? ''), /already exists/i);
  });

  test('unknown route returns 404', async () => {
    const { status } = await httpRequest(baseUrl, 'GET', '/api/plugins/unknown-route');
    assert.equal(status, 404);
  });
});
