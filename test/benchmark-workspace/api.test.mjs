/**
 * Benchmark workspace API — health and workspaceRoot allowlist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { handleBenchmarkWorkspaceRequest } from '../../server/benchmark-workspace/routes.js';
import {
  ensureBenchmarkWorkspace,
  getBenchmarkWorkspacePath,
} from '../../server/benchmark-workspace/paths.js';
import { isAllowedWorkspaceRoot } from '../../server/chats-workspace/paths.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

function createBenchmarkTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleBenchmarkWorkspaceRequest(req, res, url.pathname).then((handled) => {
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
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('benchmark workspace API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-benchmark-workspace');
    await ensureMinnowLayout();
    await ensureBenchmarkWorkspace();

    server = createBenchmarkTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  it('GET /api/benchmark-workspace returns path', async () => {
    const { status, json } = await httpRequest(baseUrl, 'GET', '/api/benchmark-workspace');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.path, getBenchmarkWorkspacePath());
  });
});

describe('benchmark workspace allowlist', () => {
  let homeDir;
  let codeWorkspace;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-benchmark-allowlist');
    await ensureMinnowLayout();
    await ensureBenchmarkWorkspace();
    codeWorkspace = path.join(homeDir, 'code-project');
    await fs.mkdir(codeWorkspace, { recursive: true });
    await initWorkspaceRoot();
    await setWorkspaceRoot(codeWorkspace);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  it('isAllowedWorkspaceRoot accepts code, chats, and benchmark workspaces', async () => {
    const { getChatsWorkspacePath, ensureChatsWorkspace } = await import(
      '../../server/chats-workspace/paths.js'
    );
    await ensureChatsWorkspace();
    assert.equal(isAllowedWorkspaceRoot(codeWorkspace), true);
    assert.equal(isAllowedWorkspaceRoot(getChatsWorkspacePath()), true);
    assert.equal(isAllowedWorkspaceRoot(getBenchmarkWorkspacePath()), true);
    assert.equal(isAllowedWorkspaceRoot(path.join(homeDir, 'other')), false);
  });

  it('executeServerTool honors workspaceRoot override under benchmark sandbox', async () => {
    const benchRoot = getBenchmarkWorkspacePath();
    await fs.mkdir(path.join(benchRoot, '.minnow-bench'), { recursive: true });
    await fs.writeFile(
      path.join(benchRoot, '.minnow-bench', 'fixture.txt'),
      'MINNOW_BENCH_MARKER\n',
      'utf8',
    );
    const { result } = await executeServerTool(
      'read_file',
      { path: '.minnow-bench/fixture.txt' },
      { workspaceRoot: benchRoot },
    );
    assert.match(result, /MINNOW_BENCH_MARKER/);
  });
});
