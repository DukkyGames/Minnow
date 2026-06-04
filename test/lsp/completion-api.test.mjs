/**
 * LSP notify + completion HTTP API (fake-lsp fixture).
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
const SAMPLE_PATH = 'test/fixtures/sample.fake';
const SAMPLE_TEXT = 'let x = 1\n';

const EXPECTED_ITEMS_JSON = `{"items":[{"label":"fakeKeyword","insertText":"fakeKeyword","kind":14,"detail":"Fake LSP keyword"},{"label":"console.log","insertText":"console.log($0)","kind":3,"detail":"Log to console"},{"label":"importHelper","insertText":"importHelper","kind":3,"detail":"Needs resolve"}]}`;

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const r = httpRequestNode(
      url,
      {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe('LSP completion API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    homeDir = path.join(__dirname, '../fixtures/lsp-completion-home');
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    shutdownAllLsp();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(homeDir, 'lsp.json'),
      `${JSON.stringify(
        {
          enabled: true,
          lsp: {
            fake: {
              disabled: false,
              command: ['node', 'test/fixtures/fake-lsp.mjs'],
              extensions: ['.fake'],
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const lspMiddleware = createLspMiddleware(PROJECT_ROOT);
    server = createServer((req, res) => {
      void lspMiddleware(req, res, () => {
        res.statusCode = 404;
        res.end('not found');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
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

  test('notify open then completion returns fake items', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }

    const open = await httpRequest(baseUrl, 'POST', '/api/lsp/notify', {
      path: SAMPLE_PATH,
      event: 'open',
      text: SAMPLE_TEXT,
    });
    assert.equal(open.status, 200);
    assert.equal(open.json.ok, true);

    const completion = await httpRequest(baseUrl, 'POST', '/api/lsp/completion', {
      path: SAMPLE_PATH,
      line: 0,
      character: 4,
    });
    assert.equal(completion.status, 200);

    const normalized = JSON.stringify({
      items: completion.json.items.map((item) => ({
        label: item.label,
        insertText: item.insertText,
        kind: item.kind,
        detail: item.detail,
      })),
    });
    assert.equal(normalized, EXPECTED_ITEMS_JSON);

    const close = await httpRequest(baseUrl, 'POST', '/api/lsp/notify', {
      path: SAMPLE_PATH,
      event: 'close',
    });
    assert.equal(close.status, 200);
    assert.equal(close.json.ok, true);
  });

  test('notify rejects invalid event', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    const res = await httpRequest(baseUrl, 'POST', '/api/lsp/notify', {
      path: SAMPLE_PATH,
      event: 'save',
    });
    assert.equal(res.status, 400);
  });
});
