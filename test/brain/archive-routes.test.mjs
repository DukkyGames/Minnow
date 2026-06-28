/**
 * Brain archive API round-trip (MIN-139).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { handleBrainRequest, initBrainApi } from '../../server/brain/routes.js';
import { shutdownAllLsp } from '../../server/lsp/manager.js';

const CHAT_ID = 'chat-archive-test-001';
const WORKSPACE_KEY = 'minnow';

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = httpRequestNode(
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
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startBrainServer(homeDir) {
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
  await fs.mkdir(homeDir, { recursive: true });
  await initBrainApi();

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const handled = await handleBrainRequest(req, res, pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('brain archive API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-archive-'));
    ({ server, baseUrl } = await startBrainServer(homeDir));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeCodeDbForTests();
    await shutdownAllLsp();
    await fs.rm(homeDir, { recursive: true, force: true });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });

  test('bundles turns with extractive fallback and idempotent re-run', async () => {
    const body = {
      chatId: CHAT_ID,
      workspaceKey: WORKSPACE_KEY,
      extractiveOnly: true,
      sourceTurnIndices: [0, 1],
      turns: [
        { role: 'user', content: 'We chose JWT for session tokens.' },
        { role: 'assistant', content: 'JWT keeps stateless auth simple.' },
      ],
    };
    const first = await httpRequest(baseUrl, 'POST', '/api/brain/archive', body);
    assert.equal(first.status, 200);
    assert.ok(first.json?.pageIds?.length);

    const second = await httpRequest(baseUrl, 'POST', '/api/brain/archive', body);
    assert.equal(second.status, 200);

    const rel = `workspaces/${WORKSPACE_KEY}/archive/${CHAT_ID}/turns-0000-0001.md`;
    const pagePath = path.join(homeDir, 'brain', 'pages', ...rel.split('/'));
    const raw = await fs.readFile(pagePath, 'utf8');
    assert.ok(raw.includes('We chose JWT for session tokens.'));
  });

  test('status reports bundled range', async () => {
    const pending = JSON.stringify([
      { startIndex: 0, endIndex: 2, sourceTurnIndices: [0, 1] },
    ]);
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/brain/archive/status?chatId=${CHAT_ID}&workspaceKey=${WORKSPACE_KEY}&pending=${encodeURIComponent(pending)}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.json?.pending?.length, 0);
    assert.ok(res.json?.ranges?.length >= 1);
  });

  test('scoped retrieve returns only this chat archive', async () => {
    const other = await httpRequest(baseUrl, 'POST', '/api/brain/archive', {
      chatId: 'other-chat',
      workspaceKey: WORKSPACE_KEY,
      extractiveOnly: true,
      sourceTurnIndices: [0],
      turns: [{ role: 'user', content: 'Other chat secret marker xyz.' }],
    });
    assert.equal(other.status, 200);

    const res = await httpRequest(baseUrl, 'POST', '/api/brain/retrieve', {
      query: 'JWT session',
      workspaceKey: WORKSPACE_KEY,
      scope: { chatId: CHAT_ID },
      includeHits: true,
      limit: 5,
    });
    assert.equal(res.status, 200);
    const hits = res.json?.hits ?? [];
    assert.ok(hits.some((h) => String(h.path).includes(CHAT_ID)));
    assert.ok(!hits.some((h) => String(h.excerpt).includes('secret marker xyz')));
  });

  test('delete removes chat archive folder', async () => {
    const del = await httpRequest(
      baseUrl,
      'DELETE',
      `/api/brain/archive/chat/${CHAT_ID}?workspaceKey=${WORKSPACE_KEY}`,
    );
    assert.equal(del.status, 200);
    const rel = `workspaces/${WORKSPACE_KEY}/archive/${CHAT_ID}`;
    const abs = path.join(homeDir, 'brain', 'pages', ...rel.split('/'));
    await assert.rejects(() => fs.access(abs));
  });

  test('delete rebuilds catalog so archive pages are not listed', async () => {
    const { listPages } = await import('../../server/brain/store.js');
    const archivePath = `workspaces/${WORKSPACE_KEY}/archive/${CHAT_ID}/turns-0000-0001.md`;
    const pages = await listPages();
    assert.ok(!pages.some((p) => p.path === archivePath));
  });
});
