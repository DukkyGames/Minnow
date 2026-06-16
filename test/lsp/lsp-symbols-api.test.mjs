/**
 * MIN-B6 — documentSymbol, workspace/symbol, callHierarchy (manager + HTTP).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import { createLspMiddleware } from '../../server/lsp/middleware.js';
import {
  getLspCallHierarchy,
  getLspDocumentSymbols,
  getLspWorkspaceSymbols,
  notifyLspDocument,
  shutdownAllLsp,
} from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_PATH = 'test/fixtures/sample.fake';
const SAMPLE_TEXT = [
  'export const MY_EXPORT = 42;',
  'function callee() { return 1; }',
  'function caller() {',
  '  callee();',
  '}',
].join('\n');

/** LSP SymbolKind — constant (14), function (12). */
const KIND_CONSTANT = 14;
const KIND_FUNCTION = 12;

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
          typescript: { disabled: true },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

describe('LSP symbols API (manager)', () => {
  let homeDir;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;
    homeDir = path.join(__dirname, '../fixtures/lsp-symbols-home');
    await seedFakeLspHome(homeDir);
  });

  after(() => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
  });

  test('getLspDocumentSymbols returns hierarchical exported symbols', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    await notifyLspDocument(SAMPLE_PATH, 'open', SAMPLE_TEXT);
    const { symbols, error } = await getLspDocumentSymbols(SAMPLE_PATH);
    assert.ifError(error ? new Error(error) : null);
    assert.ok(symbols.length >= 1);

    const exported = symbols.find((s) => s.name === 'MY_EXPORT');
    assert.ok(exported, 'expected MY_EXPORT in document symbols');
    assert.equal(exported.kind, KIND_CONSTANT);
    assert.ok(exported.range?.start);
    assert.ok(exported.selectionRange?.start);

    const nestedCallee = exported.children?.find((c) => c.name === 'callee');
    assert.ok(nestedCallee, 'expected nested callee child');
    assert.equal(nestedCallee.kind, KIND_FUNCTION);

    const caller = symbols.find((s) => s.name === 'caller');
    assert.ok(caller, 'expected top-level caller symbol');
    assert.equal(caller.kind, KIND_FUNCTION);
  });

  test('getLspWorkspaceSymbols filters by query', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const { symbols, error } = await getLspWorkspaceSymbols('MY_EXPORT');
    assert.ifError(error ? new Error(error) : null);
    assert.ok(symbols.length >= 1);

    const hit = symbols.find((s) => s.name === 'MY_EXPORT');
    assert.ok(hit, 'workspace search should find MY_EXPORT');
    assert.equal(hit.kind, KIND_CONSTANT);
    assert.match(hit.path, /sample\.fake$/);
    assert.equal(typeof hit.range?.start?.line, 'number');
  });

  test('getLspCallHierarchy returns incoming and outgoing calls', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    await notifyLspDocument(SAMPLE_PATH, 'open', SAMPLE_TEXT);

    const callerPos = await getLspCallHierarchy(SAMPLE_PATH, 1, 16);
    assert.ifError(callerPos.error ? new Error(callerPos.error) : null);
    assert.equal(callerPos.item?.name, 'caller');
    assert.equal(callerPos.item?.kind, KIND_FUNCTION);
    assert.match(callerPos.item?.path ?? '', /sample\.fake$/);
    assert.ok(callerPos.outgoingCalls.length >= 1);
    assert.equal(callerPos.outgoingCalls[0].to?.name, 'callee');
    assert.ok(Array.isArray(callerPos.outgoingCalls[0].fromRanges));

    const calleePos = await getLspCallHierarchy(SAMPLE_PATH, 0, 16);
    assert.ifError(calleePos.error ? new Error(calleePos.error) : null);
    assert.equal(calleePos.item?.name, 'callee');
    assert.ok(calleePos.incomingCalls.length >= 1);
    assert.equal(calleePos.incomingCalls[0].from?.name, 'caller');
    assert.ok(Array.isArray(calleePos.incomingCalls[0].fromRanges));
  });
});

describe('LSP symbols HTTP routes', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;
    homeDir = path.join(__dirname, '../fixtures/lsp-symbols-http-home');
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

  test('GET document-symbols + workspace-symbols + POST call-hierarchy', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const open = await httpRequest(baseUrl, 'POST', '/api/lsp/notify', {
      path: SAMPLE_PATH,
      event: 'open',
      text: SAMPLE_TEXT,
    });
    assert.equal(open.status, 200);

    const docSyms = await httpRequest(
      baseUrl,
      'GET',
      `/api/lsp/document-symbols?path=${encodeURIComponent(SAMPLE_PATH)}`,
    );
    assert.equal(docSyms.status, 200);
    assert.ok(docSyms.json.symbols?.some((s) => s.name === 'MY_EXPORT'));

    const wsSyms = await httpRequest(
      baseUrl,
      'POST',
      '/api/lsp/workspace-symbols',
      { query: 'caller' },
    );
    assert.equal(wsSyms.status, 200);
    assert.ok(wsSyms.json.symbols?.some((s) => s.name === 'caller'));

    const hierarchy = await httpRequest(baseUrl, 'POST', '/api/lsp/call-hierarchy', {
      path: SAMPLE_PATH,
      line: 1,
      character: 16,
    });
    assert.equal(hierarchy.status, 200);
    assert.equal(hierarchy.json.item?.name, 'caller');
    assert.ok(hierarchy.json.outgoingCalls?.length >= 1);
  });
});
