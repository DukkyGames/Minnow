import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { handleWorkspaceRequest } from '../../server/workspace/middleware.js';
import {
  getWorkspaceInfo,
  initWorkspaceRoot,
  setWorkspaceRoot,
} from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

function createWorkspaceTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleWorkspaceRequest(req, res, url.pathname).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

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

describe('workspace API', () => {
  let homeDir;
  let server;
  let baseUrl;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-workspace');
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'sample-project');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'README.md'), '# sample\n', 'utf8');

    await initWorkspaceRoot();

    server = createWorkspaceTestServer();
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  test('GET returns default workspace (app cwd)', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/workspace');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.ok(typeof json.path === 'string' && json.path.length > 0);
    assert.ok(typeof json.label === 'string');
  });

  test('PUT sets workspace and persists to config.json', async () => {
    const { status, json } = await httpRequest(baseUrl, 'PUT', '/api/workspace', {
      path: workspaceDir,
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(path.resolve(json.path), path.resolve(workspaceDir));

    const info = getWorkspaceInfo();
    assert.equal(path.resolve(info.path), path.resolve(workspaceDir));

    const configRaw = await fs.readFile(path.join(homeDir, 'config.json'), 'utf8');
    const config = JSON.parse(configRaw);
    assert.equal(path.resolve(config.workspace.path), path.resolve(workspaceDir));
  });

  test('PUT rejects missing directory', async () => {
    const missing = path.join(homeDir, 'does-not-exist-xyz');
    const { status, json } = await httpRequest(baseUrl, 'PUT', '/api/workspace', {
      path: missing,
    });
    assert.equal(status, 400);
    assert.match(json.error, /does not exist/i);
  });

  test('initWorkspaceRoot reloads saved path', async () => {
    await setWorkspaceRoot(workspaceDir);
    await initWorkspaceRoot();
    const info = getWorkspaceInfo();
    assert.equal(path.resolve(info.path), path.resolve(workspaceDir));
  });
});
