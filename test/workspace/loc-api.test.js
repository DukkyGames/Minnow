import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { handleWorkspaceRequest } from '../../server/workspace/middleware.js';
import { clearWorkspaceLocCache } from '../../server/workspace/loc.js';
import { getDefaultWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

function createLocTestServer() {
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

function httpGet(baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(url, { method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/workspace/loc', () => {
  let homeDir;
  let server;
  let baseUrl;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-loc');
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'loc-sample');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'a.txt'), 'one\ntwo\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'b.txt'), 'three\n', 'utf8');

    await setWorkspaceRoot(workspaceDir);
    clearWorkspaceLocCache('test-setup');

    server = createLocTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  test('returns line and file counts for the workspace', async () => {
    assert.equal(getDefaultWorkspaceRoot(), workspaceDir);
    const { status, json } = await httpGet(baseUrl, '/api/workspace/loc');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.lines, 5);
    assert.equal(json.files, 2);
  });
});
