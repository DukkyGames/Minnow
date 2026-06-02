import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { handleWorkspaceRequest } from '../../server/workspace/middleware.js';
import { getWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleWorkspaceRequest(req, res, url.pathname, url.searchParams).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

function httpJson(baseUrl, pathname, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload =
      body != null ? JSON.stringify(body) : method === 'POST' || method === 'PUT' ? '{}' : null;
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
          resolve({ status: res.statusCode, json: JSON.parse(text) });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('workspace dev-server API', () => {
  let homeDir;
  let server;
  let baseUrl;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-dev-server-api');
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'dev-ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    await setWorkspaceRoot(workspaceDir);

    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  test('startup reports no_guide without startup.md', async () => {
    const { status, json } = await httpJson(baseUrl, '/api/workspace/startup');
    assert.equal(status, 200);
    assert.equal(json.exists, false);
    assert.equal(json.status, 'no_guide');
  });

  test('start fails without startup.md', async () => {
    const { status, json } = await httpJson(
      baseUrl,
      '/api/workspace/dev-server/start',
      'POST',
    );
    assert.equal(status, 400);
    assert.equal(json.ok, false);
  });

  test('start and stop with node one-shot command', async () => {
    const startupPath = path.join(workspaceDir, 'startup.md');
    const isWin = process.platform === 'win32';
    const command = isWin
      ? 'node -e "setInterval(()=>{}, 60000)"'
      : 'node -e "setInterval(()=>{}, 60000)"';

    await fs.writeFile(
      startupPath,
      `---\ncommand: ${command}\ncwd: .\n---\n`,
      'utf8',
    );

    const start = await httpJson(baseUrl, '/api/workspace/dev-server/start', 'POST');
    assert.equal(start.status, 200);
    assert.equal(start.json.ok, true);
    assert.ok(start.json.runId);

    const status = await httpJson(baseUrl, '/api/workspace/dev-server/status');
    assert.equal(status.json.status, 'running');

    const stop = await httpJson(baseUrl, '/api/workspace/dev-server/stop', 'POST');
    assert.equal(stop.json.ok, true);
    assert.equal(stop.json.status, 'stopped');
  });

  test('GET and PUT dev-server settings', async () => {
    const put = await httpJson(
      baseUrl,
      '/api/workspace/dev-server/settings',
      'PUT',
      { port: 4321, network: 'lan' },
    );
    assert.equal(put.status, 200);
    assert.equal(put.json.settings.port, 4321);
    assert.equal(put.json.settings.network, 'lan');

    const get = await httpJson(baseUrl, '/api/workspace/dev-server/settings');
    assert.equal(get.json.settings.port, 4321);
    assert.equal(get.json.settings.network, 'lan');
  });

  test('start POST body persists port before spawn', async () => {
    const startupPath = path.join(workspaceDir, 'startup.md');
    await fs.writeFile(
      startupPath,
      '---\ncommand: node -e "setInterval(()=>{}, 60000)"\ncwd: .\n---\n',
      'utf8',
    );

    const start = await httpJson(baseUrl, '/api/workspace/dev-server/start', 'POST', {
      port: 5199,
      network: 'local',
    });
    assert.equal(start.status, 200);
    assert.equal(start.json.ok, true);

    const status = await httpJson(baseUrl, '/api/workspace/dev-server/status');
    assert.equal(status.json.settings.port, 5199);

    await httpJson(baseUrl, '/api/workspace/dev-server/stop', 'POST');
  });

  test('status poll promotes starting to running when health becomes ok', async () => {
    const startupPath = path.join(workspaceDir, 'startup.md');
    const healthPort = 38473;
    const healthUrl = `http://127.0.0.1:${healthPort}/`;
    const command = 'node -e "setInterval(()=>{}, 60000)"';

    await httpJson(baseUrl, '/api/workspace/dev-server/settings', 'PUT', {
      port: healthPort,
      network: 'local',
    });

    await fs.writeFile(
      startupPath,
      `---\ncommand: ${command}\ncwd: .\nhealthUrl: ${healthUrl}\n---\n`,
      'utf8',
    );

    const start = await httpJson(baseUrl, '/api/workspace/dev-server/start', 'POST');
    assert.equal(start.status, 200);
    assert.equal(start.json.ok, true);
    assert.equal(start.json.status, 'starting');

    const healthServer = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise((resolve) => healthServer.listen(healthPort, '127.0.0.1', resolve));

    try {
      const status = await httpJson(baseUrl, '/api/workspace/dev-server/status');
      assert.equal(status.json.status, 'running');
      assert.equal(status.json.healthOk, true);
    } finally {
      await new Promise((resolve) => healthServer.close(resolve));
      await httpJson(baseUrl, '/api/workspace/dev-server/stop', 'POST');
    }
  });
});
