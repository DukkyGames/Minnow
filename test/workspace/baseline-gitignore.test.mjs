/**
 * Baseline .gitignore for git-setup (MIN-346).
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
  BASELINE_GITIGNORE_CONTENT,
  ensureBaselineGitignore,
} from '../../server/workspace/baseline-gitignore.js';
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

describe('baseline gitignore', () => {
  let server;
  let baseUrl;
  let freshDir;
  let existingDir;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-baseline-gitignore-'));
    freshDir = path.join(root, 'fresh');
    existingDir = path.join(root, 'existing');
    await fs.mkdir(freshDir, { recursive: true });
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(path.join(existingDir, '.gitignore'), 'custom-ignore/\n', 'utf8');

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

  test('BASELINE_GITIGNORE_CONTENT includes required patterns', () => {
    assert.match(BASELINE_GITIGNORE_CONTENT, /node_modules\//);
    assert.match(BASELINE_GITIGNORE_CONTENT, /dist\//);
    assert.match(BASELINE_GITIGNORE_CONTENT, /build\//);
    assert.match(BASELINE_GITIGNORE_CONTENT, /^\.env$/m);
    assert.match(BASELINE_GITIGNORE_CONTENT, /\.env\.\*/);
    assert.match(BASELINE_GITIGNORE_CONTENT, /\.DS_Store/);
    assert.match(BASELINE_GITIGNORE_CONTENT, /Thumbs\.db/);
  });

  test('ensureBaselineGitignore creates file when missing', async () => {
    const result = await ensureBaselineGitignore(freshDir);
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    const text = await fs.readFile(path.join(freshDir, '.gitignore'), 'utf8');
    assert.equal(text, BASELINE_GITIGNORE_CONTENT);
  });

  test('ensureBaselineGitignore does not overwrite existing file', async () => {
    const before = await fs.readFile(path.join(existingDir, '.gitignore'), 'utf8');
    const result = await ensureBaselineGitignore(existingDir);
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    const after = await fs.readFile(path.join(existingDir, '.gitignore'), 'utf8');
    assert.equal(after, before);
  });

  test('POST /api/workspace/ensure-baseline-gitignore honors workspaceRoot', async () => {
    const apiFresh = path.join(path.dirname(freshDir), 'api-fresh');
    await fs.mkdir(apiFresh, { recursive: true });
    const response = await httpPost(baseUrl, '/api/workspace/ensure-baseline-gitignore', {
      workspaceRoot: apiFresh,
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.created, true);
    const text = await fs.readFile(path.join(apiFresh, '.gitignore'), 'utf8');
    assert.equal(text, BASELINE_GITIGNORE_CONTENT);
  });

  test('created baseline ignores node_modules from git status', async () => {
    const gitDir = path.join(path.dirname(freshDir), 'git-ignore');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.mkdir(path.join(gitDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(gitDir, 'node_modules', 'pkg.js'), 'module.exports = {};\n', 'utf8');
    await fs.writeFile(path.join(gitDir, 'readme.txt'), 'hello\n', 'utf8');
    await execFileAsync('git', ['init'], { cwd: gitDir, windowsHide: true });
    await ensureBaselineGitignore(gitDir);
    const status = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: gitDir,
      windowsHide: true,
    });
    const lines = String(status.stdout).trim().split('\n').filter(Boolean);
    assert.ok(lines.some((line) => line.endsWith('readme.txt')));
    assert.ok(!lines.some((line) => line.includes('node_modules')));
  });
});
