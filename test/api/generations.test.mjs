/**
 * Phase 1 integration tests: backend-owned LLM generations API.
 * Requires server/generations/* (store, upstream, routes).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  setTestHome,
  rmTestHome,
  httpRequest,
} from '../providers/test-helpers.js';
import { handleConfigRequest } from '../../server/config/middleware.js';
import { handleProviderRequest } from '../../server/providers/routes.js';
import { createGenerationsMiddleware } from '../../server/generations/routes.js';

const FIXED_KEY = 'sk-generations-test';
const PROVIDER_ID = 'mock-generations-upstream';
const CHAT_BODY = {
  model: 'mock-model-fixed',
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
};

/** Deterministic upstream SSE bytes (replay + tail assertions). */
const SSE_FIXTURE = [
  'data: {"choices":[{"delta":{"content":"alpha"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"beta"}}]}\n\n',
  'data: [DONE]\n\n',
];
/** Slower fixture for subscriber-disconnect test (50ms between chunks). */
const SSE_SLOW_FIXTURE = [
  'data: {"choices":[{"delta":{"content":"s1"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"s2"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"s3"}}]}\n\n',
  'data: [DONE]\n\n',
];

/** HTTP server: generations + providers + config (provider test pattern). */
function createGenerationsTestServer() {
  const generationsMw = createGenerationsMiddleware();
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    generationsMw(req, res, () => {
      void handleProviderRequest(req, res, url.pathname).then((handled) => {
        if (handled) return;
        void handleConfigRequest(req, res, url.pathname).then((configHandled) => {
          if (!configHandled) {
            res.statusCode = 404;
            res.end('not found');
          }
        });
      });
    });
  });
}

/**
 * GET SSE stream; collect raw body. Optionally destroy the request after N bytes.
 * @param {string} baseUrl
 * @param {string} pathname
 * @param {{ destroyAfterBytes?: number }} [opts]
 */
function collectSseStream(baseUrl, pathname, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const bodyPromise = new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const chunks = [];
    let settled = false;
    const finish = (buf) => {
      if (settled) return;
      settled = true;
      resolve(buf);
    };
    const req = http.request(
      url,
      {
        method: 'GET',
        agent: new http.Agent({ keepAlive: false }),
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.on('data', (c) => {
          chunks.push(c);
          const total = Buffer.concat(chunks).length;
          if (opts.destroyAfterBytes != null && total >= opts.destroyAfterBytes) {
            const buf = Buffer.concat(chunks);
            req.destroy();
            finish(buf);
          }
        });
        res.on('end', () => finish(Buffer.concat(chunks)));
      },
    );
    req.on('error', (err) => {
      if (settled) return;
      if (opts.destroyAfterBytes != null && chunks.length > 0) {
        finish(Buffer.concat(chunks));
        return;
      }
      settled = true;
      reject(err);
    });
    req.end();
  });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`SSE stream timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([bodyPromise, timeoutPromise]);
}

/**
 * Poll GET /api/generations/:id until status matches or timeout.
 */
async function waitForGenerationBytes(baseUrl, generationId, minBytes, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
    assert.equal(snap.status, 200);
    if ((snap.json?.totalBytes ?? 0) >= minBytes) {
      return snap.json;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  const last = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
  assert.fail(
    `Timed out waiting for totalBytes >= ${minBytes} (last: ${JSON.stringify(last.json)})`,
  );
}

async function waitForGenerationStatus(baseUrl, generationId, status, timeoutMs = 10_000) {
  const expected = Array.isArray(status) ? status : [status];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
    assert.equal(snap.status, 200, `status snapshot HTTP ${snap.status}`);
    if (expected.includes(snap.json?.status)) {
      return snap.json;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  const last = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
  assert.fail(
    `Timed out waiting for status ${JSON.stringify(expected)} (last: ${JSON.stringify(last.json)})`,
  );
}

/**
 * Mock LM Studio upstream: chat completions SSE (+ optional models for provider setup).
 * @param {{ slowStream?: boolean, onChatStart?: () => void, onChatComplete?: () => void, onChatAbortedEarly?: () => void }} hooks
 */
function createMockUpstreamServer(hooks = {}) {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/v0/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [{ id: 'mock-model-fixed', type: 'llm', state: 'loaded' }],
        }),
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v0/chat/completions') {
      hooks.onChatStart?.();
      const fixture = hooks.slowStream ? SSE_SLOW_FIXTURE : SSE_FIXTURE;
      let sentAll = false;

      res.on('close', () => {
        if (!sentAll) {
          hooks.onChatAbortedEarly?.();
        }
      });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      let index = 0;
      const writeNext = () => {
        if (index >= fixture.length) {
          sentAll = true;
          res.end();
          hooks.onChatComplete?.();
          return;
        }
        res.write(fixture[index]);
        index += 1;
        if (hooks.slowStream) {
          setTimeout(writeNext, 50);
        } else {
          writeNext();
        }
      };
      writeNext();
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });
}

async function ensureGenerationsProvider(baseUrl, mockBaseUrl) {
  const list = await httpRequest(baseUrl, 'GET', '/api/providers');
  const exists = list.json?.providers?.some((p) => p.id === PROVIDER_ID);
  if (!exists) {
    const create = await httpRequest(baseUrl, 'POST', '/api/providers', {
      id: PROVIDER_ID,
      label: 'Generations Mock',
      baseUrl: mockBaseUrl,
      apiKind: 'lm-studio-v0',
    });
    assert.equal(create.status, 201, create.text);
    await httpRequest(baseUrl, 'PUT', `/api/providers/${PROVIDER_ID}/secrets`, {
      apiKey: FIXED_KEY,
      bearerToken: '',
    });
  } else {
    const update = await httpRequest(baseUrl, 'PUT', `/api/providers/${PROVIDER_ID}`, {
      baseUrl: mockBaseUrl,
    });
    assert.equal(update.status, 200, update.text);
  }
  await httpRequest(baseUrl, 'POST', `/api/providers/${PROVIDER_ID}/set-active`);
}

async function createGeneration(baseUrl) {
  const res = await httpRequest(baseUrl, 'POST', '/api/generations', {
    providerId: PROVIDER_ID,
    body: CHAT_BODY,
  });
  assert.equal(res.status, 201, res.text);
  assert.match(res.json?.generationId, /^[0-9a-f-]{36}$/i);
  return res.json.generationId;
}

let homeDir;
let baseUrl;
let mockBaseUrl;
let server;
let mockServer;

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-test-generations');
  server = createGenerationsTestServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;

  mockServer = createMockUpstreamServer();
  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', resolve);
  });
  const mockPort = /** @type {import('net').AddressInfo} */ (mockServer.address()).port;
  mockBaseUrl = `http://127.0.0.1:${mockPort}`;

  await ensureGenerationsProvider(baseUrl, mockBaseUrl);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => mockServer.close(resolve));
  await rmTestHome(homeDir);
});

describe('POST /api/generations + GET status lifecycle', () => {
  it('creates generationId and transitions pending â†’ streaming â†’ complete', async () => {
    const generationId = await createGeneration(baseUrl);

    const statusTrail = [];
    const streamPromise = collectSseStream(
      baseUrl,
      `/api/generations/${generationId}/stream`,
    );

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const snap = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
      assert.equal(snap.status, 200);
      const status = snap.json?.status;
      if (statusTrail.at(-1) !== status) {
        statusTrail.push(status);
      }
      if (status === 'complete') {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }

    const streamBuf = await streamPromise;
    assert.ok(streamBuf.length > 0);
    assert.ok(statusTrail.includes('complete'), `trail: ${statusTrail.join(' -> ')}`);
    assert.ok(
      statusTrail.includes('streaming'),
      `expected streaming in status trail, got: ${statusTrail.join(' -> ')}`,
    );

    const complete = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
    assert.equal(complete.json.status, 'complete');
    assert.ok(complete.json.totalBytes > 0);
    assert.ok(complete.json.startedAt);
    assert.ok(complete.json.finishedAt);
  });
});

describe('parallel stream subscribers', () => {
  it('two GET /stream clients receive identical replay + tail from mock upstream', async () => {
    const generationId = await createGeneration(baseUrl);
    // Fast mock upstream may skip observable "streaming" and land on "complete" first.
    await waitForGenerationStatus(baseUrl, generationId, ['streaming', 'complete']);

    const [a, b] = await Promise.all([
      collectSseStream(baseUrl, `/api/generations/${generationId}/stream`),
      collectSseStream(baseUrl, `/api/generations/${generationId}/stream`),
    ]);

    assert.equal(a.toString('utf8'), b.toString('utf8'));
    assert.ok(a.includes('alpha'));
    assert.ok(a.includes('beta'));
    assert.ok(a.includes('[DONE]') || a.includes('event: end'));

    await waitForGenerationStatus(baseUrl, generationId, 'complete');
  });
});

describe('subscriber disconnect does not cancel upstream', () => {
  it('closing one stream mid-flight leaves other complete and status streaming until upstream ends', async () => {
    let upstreamAbortedEarly = false;
    let upstreamCompleted = false;

    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = createMockUpstreamServer({
      slowStream: true,
      onChatAbortedEarly: () => {
        upstreamAbortedEarly = true;
      },
      onChatComplete: () => {
        upstreamCompleted = true;
      },
    });
    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    const mockPort = /** @type {import('net').AddressInfo} */ (mockServer.address()).port;
    mockBaseUrl = `http://127.0.0.1:${mockPort}`;
    await ensureGenerationsProvider(baseUrl, mockBaseUrl);

    const generationId = await createGeneration(baseUrl);
    await waitForGenerationStatus(baseUrl, generationId, 'streaming');
    await waitForGenerationBytes(baseUrl, generationId, 1);

    const slowExpected = SSE_SLOW_FIXTURE.join('');

    const earlyBuf = await collectSseStream(
      baseUrl,
      `/api/generations/${generationId}/stream`,
      { destroyAfterBytes: 30 },
    );
    assert.ok(earlyBuf.length >= 30);

    const midStatus = await httpRequest(baseUrl, 'GET', `/api/generations/${generationId}`);
    assert.equal(midStatus.json.status, 'streaming');

    const survivorBuf = await collectSseStream(
      baseUrl,
      `/api/generations/${generationId}/stream`,
    );

    assert.equal(
      upstreamAbortedEarly,
      false,
      'upstream fetch must not abort when a stream subscriber disconnects',
    );
    const survivorText = survivorBuf.toString('utf8');
    assert.ok(survivorText.startsWith(slowExpected));
    assert.ok(survivorText.includes('event: end'));
    assert.ok(survivorText.includes('"status":"complete"'));
    assert.equal(upstreamCompleted, true);

    await waitForGenerationStatus(baseUrl, generationId, 'complete');
  });
});

describe('POST /api/generations/:id/cancel', () => {
  it('sets status to cancelled', async () => {
    let upstreamAbortedEarly = false;
    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = createMockUpstreamServer({
      slowStream: true,
      onChatAbortedEarly: () => {
        upstreamAbortedEarly = true;
      },
    });
    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    const mockPort = /** @type {import('net').AddressInfo} */ (mockServer.address()).port;
    mockBaseUrl = `http://127.0.0.1:${mockPort}`;
    await ensureGenerationsProvider(baseUrl, mockBaseUrl);

    const generationId = await createGeneration(baseUrl);
    await waitForGenerationStatus(baseUrl, generationId, 'streaming');

    const cancel = await httpRequest(
      baseUrl,
      'POST',
      `/api/generations/${generationId}/cancel`,
    );
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json?.ok, true);

    const cancelled = await waitForGenerationStatus(baseUrl, generationId, 'cancelled');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(upstreamAbortedEarly, true);
  });
});


