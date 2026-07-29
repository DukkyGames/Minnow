/**
 * Brain manual capture — upsert, extractive fallback, and route round-trip.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import {
  captureChatToBrain,
  captureResearchToBrain,
  chatCaptureRelPath,
  researchCaptureRelPath,
} from '../../server/brain/capture.js';
import { readPage } from '../../server/brain/store.js';
import { getResearchFilePath } from '../../server/research/store.js';
import { handleBrainRequest, initBrainApi } from '../../server/brain/routes.js';
import { shutdownAllLsp } from '../../server/lsp/manager.js';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_KEY = 'minnow';
const RESEARCH_ID = 'rs-cafe00000001';

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
  await ensureMinnowLayout();
  await initBrainApi();
  // Capture tests do not cover vector sync — disable embeddings so scheduled sync is a no-op
  // and teardown does not race fire-and-forget embedder I/O on CI.
  const configPath = path.join(homeDir, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.memory = config.memory ?? {};
  config.memory.embeddings = { ...(config.memory.embeddings ?? {}), enabled: false };
  config.brain = config.brain ?? {};
  config.brain.embeddings = { ...(config.brain.embeddings ?? {}), enabled: false };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

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

async function seedResearchFixture(homeDir) {
  const report = `## TL;DR

JWT sessions keep auth stateless.

## Key findings

### Auth choice
We chose JWT for session tokens [1].

## Sources

1. Example source
`;
  const disk = {
    id: RESEARCH_ID,
    query: 'JWT vs sessions',
    status: 'done',
    result: report,
    sources: [{ url: 'https://example.com/jwt', title: 'JWT guide' }],
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:05:00.000Z',
  };
  const filePath = getResearchFilePath(RESEARCH_ID);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(disk, null, 2), 'utf8');
}

describe('brain capture', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-capture-'));
    ({ server, baseUrl } = await startBrainServer(homeDir));
    await seedResearchFixture(homeDir);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeCodeDbForTests();
    await shutdownAllLsp();
    // initBrainApi opens sessions.db via readAllChatIds — close before rm (Windows EBUSY).
    closeSessionsDb();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });

  test('chat capture with extractiveOnly creates page at stable path', async () => {
    const relPath = chatCaptureRelPath(WORKSPACE_KEY, CHAT_ID);
    const first = await captureChatToBrain({
      chatId: CHAT_ID,
      title: 'Auth discussion',
      workspaceKey: WORKSPACE_KEY,
      extractiveOnly: true,
      messages: [
        { role: 'user', content: 'We chose JWT for session tokens.' },
        { role: 'assistant', content: 'JWT keeps stateless auth simple.' },
      ],
    });

    assert.equal(first.ok, true);
    assert.equal(first.relPath, relPath);
    assert.equal(first.created, true);
    assert.ok(first.pageId);

    const page = await readPage(relPath);
    assert.match(page.body, /JWT/);
    assert.ok(page.meta.tags.includes('capture'));
    assert.ok(page.meta.tags.includes(`chat:${CHAT_ID}`));
  });

  test('second chat capture updates same path with same pageId', async () => {
    const relPath = chatCaptureRelPath(WORKSPACE_KEY, CHAT_ID);
    const before = await readPage(relPath);
    const pageId = before.meta.id;
    const updatedAt = before.meta.updatedAt;

    await new Promise((r) => setTimeout(r, 15));

    const second = await captureChatToBrain({
      chatId: CHAT_ID,
      title: 'Auth discussion (updated)',
      workspaceKey: WORKSPACE_KEY,
      extractiveOnly: true,
      messages: [
        { role: 'user', content: 'We chose JWT for session tokens.' },
        { role: 'assistant', content: 'JWT keeps stateless auth simple.' },
        { role: 'user', content: 'Also set refresh token rotation.' },
        { role: 'assistant', content: 'Rotation limits replay window.' },
      ],
    });

    assert.equal(second.created, false);
    assert.equal(second.pageId, pageId);

    const after = await readPage(relPath);
    assert.equal(after.meta.id, pageId);
    assert.ok(after.meta.updatedAt >= updatedAt);
    assert.match(after.body, /refresh token/);
  });

  test('research capture from fixture markdown', async () => {
    const relPath = researchCaptureRelPath(RESEARCH_ID);
    const result = await captureResearchToBrain({ researchId: RESEARCH_ID });

    assert.equal(result.ok, true);
    assert.equal(result.relPath, relPath);
    assert.equal(result.title, 'JWT vs sessions');

    const page = await readPage(relPath);
    assert.match(page.body, /## TL;DR/);
    assert.match(page.body, /example\.com\/jwt/);
    assert.ok(page.meta.tags.includes(`research:${RESEARCH_ID}`));
    assert.ok(page.meta.input_hash);
  });

  test('POST /api/brain/capture/chat round-trip', async () => {
    const chatId = '22222222-2222-2222-2222-222222222222';
    const { status, json } = await httpRequest(baseUrl, 'POST', '/api/brain/capture/chat', {
      chatId,
      workspaceKey: WORKSPACE_KEY,
      extractiveOnly: true,
      title: 'Route test chat',
      messages: [
        { role: 'user', content: 'Hello from route test.' },
        { role: 'assistant', content: 'Captured via HTTP.' },
      ],
    });

    assert.equal(status, 200);
    assert.equal(json.relPath, chatCaptureRelPath(WORKSPACE_KEY, chatId));
    assert.equal(json.created, true);
  });

  test('POST /api/brain/capture/research round-trip', async () => {
    const { status, json } = await httpRequest(baseUrl, 'POST', '/api/brain/capture/research', {
      researchId: RESEARCH_ID,
    });

    assert.equal(status, 200);
    assert.equal(json.relPath, researchCaptureRelPath(RESEARCH_ID));
    assert.equal(json.title, 'JWT vs sessions');
  });

  test('POST /api/brain/capture/chat rejects empty dialogue', async () => {
    const { status, json } = await httpRequest(baseUrl, 'POST', '/api/brain/capture/chat', {
      chatId: CHAT_ID,
      workspaceKey: WORKSPACE_KEY,
      messages: [{ role: 'tool', content: 'only tools' }],
    });

    assert.equal(status, 400);
    assert.match(json.error, /user or assistant/i);
  });

  test('POST /api/brain/capture/research returns 404 for missing id', async () => {
    const { status, json } = await httpRequest(baseUrl, 'POST', '/api/brain/capture/research', {
      researchId: 'rs-deadbeef0000',
    });

    assert.equal(status, 404);
    assert.match(json.error, /not found/i);
  });
});
