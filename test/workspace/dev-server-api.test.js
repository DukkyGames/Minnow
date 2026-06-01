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

function httpJson(baseUrl, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(url, { method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (method === 'POST') req.write('{}');
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
});
