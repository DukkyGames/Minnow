/**
 * Desktop workspace API — health, list, download, and workspaceRoot allowlist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { handleDesktopWorkspaceRequest } from '../../server/desktop-workspace/routes.js';
import {
  ensureDesktopWorkspace,
  getDesktopWorkspacePath,
  initDesktopWorkspacePath,
  resetDesktopWorkspacePathForTests,
  setDesktopWorkspacePath,
} from '../../server/desktop-workspace/paths.js';
import { isAllowedWorkspaceRoot } from '../../server/chats-workspace/paths.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

function createDesktopTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleDesktopWorkspaceRequest(req, res, url.pathname, url.searchParams).then((handled) => {
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
    const req = http.request(
      url,
      {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    },
    );
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('desktop workspace API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-desktop-workspace');
    resetDesktopWorkspacePathForTests();
    await ensureMinnowLayout();
    await ensureDesktopWorkspace();
    await initDesktopWorkspacePath();

    const desktopRoot = getDesktopWorkspacePath();
    await fs.writeFile(path.join(desktopRoot, 'note.txt'), 'hello desktop\n', 'utf8');

    server = createDesktopTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    resetDesktopWorkspacePathForTests();
    await rmTestHome(homeDir);
  });

  it('GET /api/desktop-workspace returns path and fileCount', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/desktop-workspace');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.path, getDesktopWorkspacePath());
    assert.ok(json.fileCount >= 2);
  });

  it('desktop workspace path is in tool workspaceRoot allowlist', () => {
    assert.equal(isAllowedWorkspaceRoot(getDesktopWorkspacePath()), true);
  });

  it('PUT /api/desktop-workspace changes the active desktop workspace path', async () => {
    const customDir = path.join(homeDir, 'custom-desktop-ws');
    await fs.mkdir(customDir, { recursive: true });

    const { status, json } = await httpRequest(baseUrl, 'PUT', '/api/desktop-workspace', {
      path: customDir,
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.path, customDir);
    assert.equal(getDesktopWorkspacePath(), customDir);
    assert.equal(isAllowedWorkspaceRoot(customDir), true);

    const { readConfigJson } = await import('../../server/config/store.js');
    const config = await readConfigJson('config.json');
    assert.equal(config?.desktopWorkspace?.path, customDir);

    resetDesktopWorkspacePathForTests();
    await initDesktopWorkspacePath();
    assert.equal(getDesktopWorkspacePath(), customDir);
  });
});
