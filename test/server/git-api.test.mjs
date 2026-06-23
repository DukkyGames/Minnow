/**
 * POST /api/git — git operations against a temp repository.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import {
  branches,
  commit,
  diff,
  log,
  show,
  stage,
  status,
} from '../../server/git/git-ops.js';
import { handleGitRequest } from '../../server/git/middleware.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';
import { httpRequest } from '../config/test-helpers.js';

const execFileAsync = promisify(execFile);

function createGitTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleGitRequest(req, res, url.pathname).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

describe('git API', () => {
  let repoDir;
  let plainDir;
  let server;
  let baseUrl;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-git-api-'));
    repoDir = path.join(root, 'repo');
    plainDir = path.join(root, 'plain');
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(plainDir, { recursive: true });

    await setWorkspaceRoot(repoDir);
    await execFileAsync('git', ['init'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repoDir,
      windowsHide: true,
    });

    server = createGitTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('status buckets untracked and modified files', async () => {
    await fs.writeFile(path.join(repoDir, 'tracked.txt'), 'v1\n', 'utf8');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'add tracked'], {
      cwd: repoDir,
      windowsHide: true,
    });

    await fs.writeFile(path.join(repoDir, 'tracked.txt'), 'v2\n', 'utf8');
    await fs.writeFile(path.join(repoDir, 'new.txt'), 'hello\n', 'utf8');

    const res = await status({ cwd: repoDir });
    assert.equal(res.ok, true);
    assert.ok(res.untracked?.some((f) => f.path === 'new.txt' && f.status === '?'));
    assert.ok(res.unstaged?.some((f) => f.path === 'tracked.txt'));
  });

  test('stage, commit, and log', async () => {
    await stage({ cwd: repoDir, paths: ['new.txt'] });
    const stagedStatus = await status({ cwd: repoDir });
    assert.ok(stagedStatus.staged?.some((f) => f.path === 'new.txt'));

    const committed = await commit({ cwd: repoDir, message: 'add new file' });
    assert.equal(committed.ok, true);
    assert.match(committed.sha ?? '', /^[0-9a-f]{40}$/);

    const history = await log({ cwd: repoDir, count: 5 });
    assert.equal(history.ok, true);
    assert.ok(history.commits?.some((c) => c.subject === 'add new file'));
  });

  test('diff and show return patch output', async () => {
    const patch = await diff({ cwd: repoDir, path: 'tracked.txt' });
    assert.equal(patch.ok, true);
    assert.match(patch.patch ?? '', /tracked\.txt/);

    const history = await log({ cwd: repoDir, count: 1 });
    const sha = history.commits?.[0]?.hash;
    assert.ok(sha);

    const detail = await show({ cwd: repoDir, sha });
    assert.equal(detail.ok, true);
    assert.match(detail.stat ?? '', /files? changed/);
    assert.match(detail.patch ?? '', /diff --git/);
  });

  test('branches lists current branch', async () => {
    const listed = await branches({ cwd: repoDir });
    assert.equal(listed.ok, true);
    assert.ok(listed.current);
    assert.ok(listed.local?.includes(listed.current));
  });

  test('POST /api/git status honors cwd', async () => {
    const missing = await httpRequest(baseUrl, 'POST', '/api/git', {
      op: 'status',
      cwd: plainDir,
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.json?.ok, false);
    assert.match(missing.json?.error ?? '', /Not a git repository/);

    const ok = await httpRequest(baseUrl, 'POST', '/api/git', {
      op: 'status',
      cwd: repoDir,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json?.ok, true);
    assert.ok(Array.isArray(ok.json?.staged));
  });

  test('rejects unknown git op', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/git', { op: 'nope' });
    assert.equal(res.status, 400);
    assert.match(res.json?.error ?? '', /Unknown git op/);
  });
});
