/**
 * LSP Phase 2 HTTP API — structured diagnostics + hover (fake-lsp fixture).
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
import {
  getLspCompletions,
  getLspHover,
  getLspStructuredDiagnostics,
  notifyLspDocument,
  shutdownAllLsp,
} from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_PATH = 'test/fixtures/sample.fake';
const SAMPLE_TEXT = 'let x = 1\n';

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

async function seedFakeLspHome(homeDir) {
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
}

describe('LSP UX API (manager)', () => {
  let homeDir;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;
    homeDir = path.join(__dirname, '../fixtures/lsp-ux-home');
    await seedFakeLspHome(homeDir);
  });

  after(() => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
  });

  test('getLspStructuredDiagnostics returns raw severity + message', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const { diagnostics } = await getLspStructuredDiagnostics(SAMPLE_PATH);
    assert.ok(Array.isArray(diagnostics));
    assert.ok(diagnostics.length >= 1);
    const first = diagnostics[0];
    assert.equal(first.severity, 1);
    assert.match(first.message, /';' expected/);
    assert.equal(typeof first.range?.start?.line, 'number');
  });

  test('getLspCompletions normalizes textEdit and insertReplace ranges', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    await notifyLspDocument(SAMPLE_PATH, 'open', SAMPLE_TEXT);
    const { items } = await getLspCompletions(SAMPLE_PATH, 0, 5);
    const rangeEdit = items.find((i) => i.label === 'rangeEdit');
    assert.ok(rangeEdit?.textEditRange);
    assert.equal(rangeEdit.insertText, 'edited');
    const insertReplace = items.find((i) => i.label === 'insertReplace');
    assert.ok(insertReplace?.textEditInsertRange);
    assert.ok(insertReplace?.textEditReplaceRange);
    assert.equal(insertReplace.insertText, 'replaced');
  });

  test('getLspHover returns markdown contents for .fake', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const { hover } = await getLspHover(SAMPLE_PATH, 0, 0);
    assert.ok(hover?.contents);
    const text =
      typeof hover.contents === 'object' && hover.contents?.value
        ? hover.contents.value
        : String(hover.contents);
    assert.match(text, /Fake hover/i);
  });
});

describe('LSP UX HTTP routes', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;
    homeDir = path.join(__dirname, '../fixtures/lsp-ux-http-home');
    await seedFakeLspHome(homeDir);

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

  test('POST diagnostics-structured + hover after notify open', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const open = await httpRequest(baseUrl, 'POST', '/api/lsp/notify', {
      path: SAMPLE_PATH,
      event: 'open',
      text: SAMPLE_TEXT,
    });
    assert.equal(open.status, 200);

    const diags = await httpRequest(baseUrl, 'POST', '/api/lsp/diagnostics-structured', {
      path: SAMPLE_PATH,
    });
    assert.equal(diags.status, 200);
    assert.ok(Array.isArray(diags.json.diagnostics));
    assert.match(diags.json.diagnostics[0]?.message ?? '', /';' expected/);

    const hover = await httpRequest(baseUrl, 'POST', '/api/lsp/hover', {
      path: SAMPLE_PATH,
      line: 0,
      character: 0,
    });
    assert.equal(hover.status, 200);
    const hoverText =
      hover.json.hover?.contents?.value ?? hover.json.hover?.contents ?? '';
    assert.match(String(hoverText), /Fake hover/i);
  });
});
