/**
 * GET /api/workspace/git-status — workspace git repository detection.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { handleWorkspaceRequest } from '../../server/workspace/middleware.js';
import { getWorkspaceGitStatus } from '../../server/workspace/git-status.js';

const execFileAsync = promisify(execFile);

function createWorkspaceTestServer() {
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

describe('workspace git-status', () => {
  let server;
  let baseUrl;
  let plainDir;
  let gitDir;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-git-status-'));
    plainDir = path.join(root, 'plain');
    gitDir = path.join(root, 'git');
    await fs.mkdir(plainDir, { recursive: true });
    await fs.mkdir(gitDir, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: gitDir, windowsHide: true });

    server = createWorkspaceTestServer();
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('getWorkspaceGitStatus returns false for non-repo', async () => {
    const status = await getWorkspaceGitStatus(plainDir);
    assert.equal(status.isGitRepo, false);
    assert.equal(status.hasRemote, false);
  });

  test('getWorkspaceGitStatus returns true after git init without remote', async () => {
    const status = await getWorkspaceGitStatus(gitDir);
    assert.equal(status.isGitRepo, true);
    assert.equal(status.hasRemote, false);
  });

  test('getWorkspaceGitStatus reports origin remote when configured', async () => {
    const withRemote = path.join(path.dirname(gitDir), 'git-remote');
    await fs.mkdir(withRemote, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: withRemote, windowsHide: true });
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/example/minnow.git'],
      { cwd: withRemote, windowsHide: true },
    );
    const status = await getWorkspaceGitStatus(withRemote);
    assert.equal(status.isGitRepo, true);
    assert.equal(status.hasRemote, true);
  });

  test('GET /api/workspace/git-status honors workspaceRoot query', async () => {
    const plain = await httpGet(
      baseUrl,
      `/api/workspace/git-status?workspaceRoot=${encodeURIComponent(plainDir)}`,
    );
    assert.equal(plain.status, 200);
    assert.equal(plain.json.ok, true);
    assert.equal(plain.json.isGitRepo, false);
    assert.equal(plain.json.hasRemote, false);

    const git = await httpGet(
      baseUrl,
      `/api/workspace/git-status?workspaceRoot=${encodeURIComponent(gitDir)}`,
    );
    assert.equal(git.status, 200);
    assert.equal(git.json.ok, true);
    assert.equal(git.json.isGitRepo, true);
    assert.equal(git.json.hasRemote, false);
  });
});
