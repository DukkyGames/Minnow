/**
 * Chats workspace API — health, list, download, and workspaceRoot allowlist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { handleChatsWorkspaceRequest } from '../../server/chats-workspace/routes.js';
import {
  ensureChatsWorkspace,
  getChatsWorkspacePath,
  isAllowedWorkspaceRoot,
} from '../../server/chats-workspace/paths.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

function createChatsTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleChatsWorkspaceRequest(req, res, url.pathname, url.searchParams).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

function httpRequest(baseUrl, method, pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(url, { method }, (res) => {
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
    });
    req.on('error', reject);
    req.end();
  });
}

describe('chats workspace API', () => {
  let homeDir;
  let server;
  let baseUrl;
  let codeWorkspace;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-chats-workspace');
    await ensureMinnowLayout();
    await ensureChatsWorkspace();
    codeWorkspace = path.join(homeDir, 'code-project');
    await fs.mkdir(codeWorkspace, { recursive: true });
    await initWorkspaceRoot();
    await setWorkspaceRoot(codeWorkspace);

    const chatsRoot = getChatsWorkspacePath();
    await fs.writeFile(path.join(chatsRoot, 'note.txt'), 'hello chats\n', 'utf8');
    await fs.mkdir(path.join(chatsRoot, 'nested'), { recursive: true });
    await fs.writeFile(path.join(chatsRoot, 'nested', 'inner.md'), '# inner\n', 'utf8');

    server = createChatsTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  it('GET /api/chats-workspace returns path and fileCount', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/chats-workspace');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.path, getChatsWorkspacePath());
    assert.ok(json.fileCount >= 3);
  });

  it('GET /api/chats-workspace/list lists files under chats root', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/chats-workspace/list');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const names = json.entries.map((e) => e.name).sort();
    assert.ok(names.includes('README.md'));
    assert.ok(names.includes('nested'));
    assert.ok(names.includes('note.txt'));
  });

  it('GET /api/chats-workspace/download streams a file', async () => {
    const { status, text, headers } = await httpRequest(
      baseUrl,
      'GET',
      '/api/chats-workspace/download?path=note.txt',
    );
    assert.equal(status, 200);
    assert.match(headers['content-disposition'], /attachment/);
    assert.equal(text, 'hello chats\n');
  });

  it('rejects traversal outside chats root', async () => {
    const { status, json } = await httpRequest(
      baseUrl,
      'GET',
      '/api/chats-workspace/download?path=..%2F..%2Fsecrets.txt',
    );
    assert.equal(status, 400);
    assert.match(json.error, /outside the chats workspace/i);
  });
});

describe('chats workspace allowlist', () => {
  let homeDir;
  let codeWorkspace;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-chats-allowlist');
    await ensureMinnowLayout();
    await ensureChatsWorkspace();
    codeWorkspace = path.join(homeDir, 'code-project');
    await fs.mkdir(codeWorkspace, { recursive: true });
    await initWorkspaceRoot();
    await setWorkspaceRoot(codeWorkspace);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  it('isAllowedWorkspaceRoot accepts code workspace and chats workspace only', () => {
    assert.equal(isAllowedWorkspaceRoot(codeWorkspace), true);
    assert.equal(isAllowedWorkspaceRoot(getChatsWorkspacePath()), true);
    assert.equal(isAllowedWorkspaceRoot(path.join(homeDir, 'other')), false);
  });

  it('executeServerTool honors workspaceRoot override under chats sandbox', async () => {
    const chatsRoot = getChatsWorkspacePath();
    await fs.writeFile(path.join(chatsRoot, 'allowlist-note.txt'), 'scoped\n', 'utf8');
    const { result } = await executeServerTool(
      'list_directory',
      { path: '.' },
      { workspaceRoot: chatsRoot },
    );
    assert.match(result, /allowlist-note\.txt/);
    assert.match(result, /README\.md/);
  });
});
