/**
 * POST /api/workspace/initialize-git — programmatic board onboarding git init (MIN-615).
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
  INITIAL_COMMIT_MESSAGE,
  initializeWorkspaceGit,
} from '../../server/workspace/initialize-git.js';
import { BASELINE_GITIGNORE_CONTENT } from '../../server/workspace/baseline-gitignore.js';
import { handleWorkspaceRequest } from '../../server/workspace/middleware.js';

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

function httpPost(baseUrl, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = JSON.stringify(body ?? {});
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
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
    req.write(payload);
    req.end();
  });
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, windowsHide: true });
}

describe('initialize workspace git', () => {
  let server;
  let baseUrl;
  let tmpRoot;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-initialize-git-'));
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

  test('initializeWorkspaceGit creates repo, gitignore, and initial commit', async () => {
    const dir = path.join(tmpRoot, 'fresh');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'readme.txt'), 'hello\n', 'utf8');

    const result = await initializeWorkspaceGit(dir);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyRepo, false);
    assert.equal(result.createdRepo, true);
    assert.equal(result.gitignoreCreated, true);
    assert.equal(result.committed, true);
    assert.match(result.commitSha ?? '', /^[0-9a-f]{40}$/i);

    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    assert.equal(ignore, BASELINE_GITIGNORE_CONTENT);

    const inside = await git(dir, ['rev-parse', '--is-inside-work-tree']);
    assert.equal(String(inside.stdout).trim(), 'true');

    const log = await git(dir, ['log', '-1', '--pretty=%s']);
    assert.equal(String(log.stdout).trim(), INITIAL_COMMIT_MESSAGE);

    const branch = await git(dir, ['branch', '--show-current']);
    assert.equal(String(branch.stdout).trim(), 'main');
  });

  test('initializeWorkspaceGit does not overwrite an existing .gitignore', async () => {
    const dir = path.join(tmpRoot, 'custom-ignore');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '.gitignore'), 'custom-ignore/\n', 'utf8');

    const result = await initializeWorkspaceGit(dir);
    assert.equal(result.ok, true);
    assert.equal(result.gitignoreCreated, false);
    const after = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    assert.equal(after, 'custom-ignore/\n');
  });

  test('initializeWorkspaceGit is idempotent when HEAD already exists', async () => {
    const dir = path.join(tmpRoot, 'existing-head');
    await fs.mkdir(dir, { recursive: true });
    await git(dir, ['init', '-b', 'main']);
    await git(dir, ['config', 'user.email', 'test@example.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    await fs.writeFile(path.join(dir, 'seed.txt'), 'seed\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'seed']);

    const result = await initializeWorkspaceGit(dir);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyRepo, true);
    assert.equal(result.createdRepo, false);
    assert.equal(result.committed, false);

    const log = await git(dir, ['log', '-1', '--pretty=%s']);
    assert.equal(String(log.stdout).trim(), 'seed');
  });

  test('created baseline ignores node_modules in the initial commit', async () => {
    const dir = path.join(tmpRoot, 'with-modules');
    await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(dir, 'node_modules', 'pkg.js'), 'module.exports = {};\n', 'utf8');
    await fs.writeFile(path.join(dir, 'readme.txt'), 'hello\n', 'utf8');

    const result = await initializeWorkspaceGit(dir);
    assert.equal(result.ok, true);
    assert.equal(result.committed, true);

    const ls = await git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']);
    const files = String(ls.stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(files.includes('readme.txt'));
    assert.ok(files.includes('.gitignore'));
    assert.ok(!files.some((file) => file.includes('node_modules')));
  });

  test('POST /api/workspace/initialize-git honors workspaceRoot', async () => {
    const dir = path.join(tmpRoot, 'api-fresh');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'app.js'), 'console.log(1)\n', 'utf8');

    const response = await httpPost(baseUrl, '/api/workspace/initialize-git', {
      workspaceRoot: dir,
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.createdRepo, true);
    assert.equal(response.json.committed, true);

    const inside = await git(dir, ['rev-parse', '--is-inside-work-tree']);
    assert.equal(String(inside.stdout).trim(), 'true');
  });
});
