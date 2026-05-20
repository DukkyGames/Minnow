/**
 * GET /api/config/lsp returns full merged catalog (feature-02).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { request as httpRequestNode } from 'node:http';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import { createLspMiddleware } from '../../server/lsp/middleware.js';
import { shutdownAllLsp } from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STALE_FIXTURE = path.join(__dirname, '../fixtures/lsp-stale-home');

function httpGet(baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const r = httpRequestNode(url, { method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: JSON.parse(raw) });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

describe('GET /api/config/lsp catalog', () => {
  let homeDir;
  let server;
  let baseUrl;
  let defaultCount;

  before(async () => {
    const defaults = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, 'src/lsp/defaults.json'), 'utf8'),
    );
    defaultCount = Object.keys(defaults.lsp ?? {}).length;
    assert.equal(defaultCount, 39);

    homeDir = path.join(__dirname, '../fixtures/lsp-config-api-home');
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    shutdownAllLsp();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.copyFile(
      path.join(STALE_FIXTURE, 'lsp.json'),
      path.join(homeDir, 'lsp.json'),
    );

    const lspMiddleware = createLspMiddleware(PROJECT_ROOT);
    server = createServer((req, res) => {
      void lspMiddleware(req, res, () => {
        res.statusCode = 404;
        res.end('not found');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    if (homeDir) {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  test('servers.length matches defaults.json key count', async () => {
    const res = await httpGet(baseUrl, '/api/config/lsp');
    assert.equal(res.status, 200);
    assert.equal(res.json.servers.length, defaultCount);
    assert.equal(res.json.enabled, true);
    assert.ok(res.json.lsp.typescript);
    assert.ok(res.json.lsp.pyright);
  });

  test('eslint row includes requirements and disabledReason when disabled', async () => {
    const res = await httpGet(baseUrl, '/api/config/lsp');
    const eslint = res.json.servers.find((s) => s.id === 'eslint');
    assert.ok(eslint);
    assert.equal(eslint.requirements?.package, 'eslint');
    assert.equal(eslint.disabled, true);
    assert.match(String(eslint.disabledReason ?? ''), /Disabled in settings/);
    assert.match(String(eslint.disabledReason ?? ''), /Requires:.*eslint/);
  });

  test('typescript is enabled with command', async () => {
    const res = await httpGet(baseUrl, '/api/config/lsp');
    const ts = res.json.servers.find((s) => s.id === 'typescript');
    assert.ok(ts);
    assert.equal(ts.disabled, false);
    assert.equal(ts.hasCommand, true);
    assert.equal(ts.defaultEnabled, true);
  });
});
