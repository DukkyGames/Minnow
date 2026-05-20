/**
 * Integration tests: provider CRUD, secrets redaction, proxy auth headers.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  setTestHome,
  rmTestHome,
  createProviderTestServer,
  httpRequest,
} from './test-helpers.js';

const FIXED_KEY = 'sk-fixed-key';
const FIXED_BEARER = 'test-bearer-fixed';

let homeDir;
let baseUrl;
let mockBaseUrl;
let server;
let mockServer;
/** @type {Record<string, string>} */
let lastMockHeaders = {};

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-test-step03');
  server = createProviderTestServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;

  mockServer = http.createServer((req, res) => {
    lastMockHeaders = { ...req.headers };
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
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', resolve);
  });
  const mockPort = /** @type {import('net').AddressInfo} */ (mockServer.address()).port;
  mockBaseUrl = `http://127.0.0.1:${mockPort}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => mockServer.close(resolve));
  await rmTestHome(homeDir);
});

describe('provider CRUD + proxy', () => {
  it('seeds lm-studio-local on first GET', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/providers');
    assert.equal(res.status, 200);
    assert.ok(res.json.providers.some((p) => p.id === 'lm-studio-local'));
    assert.equal(res.json.activeProviderId, 'lm-studio-local');
  });

  it('CRUD roundtrip for second provider', async () => {
    const create = await httpRequest(baseUrl, 'POST', '/api/providers', {
      id: 'mock-remote-fixed',
      label: 'Mock Remote',
      baseUrl: mockBaseUrl,
      apiKind: 'lm-studio-v0',
      connectionMode: 'proxy',
    });
    assert.equal(create.status, 201);
    assert.equal(create.json.id, 'mock-remote-fixed');

    const list = await httpRequest(baseUrl, 'GET', '/api/providers');
    assert.ok(list.json.providers.some((p) => p.id === 'mock-remote-fixed'));

    const update = await httpRequest(baseUrl, 'PUT', '/api/providers/mock-remote-fixed', {
      label: 'Mock Remote Updated',
    });
    assert.equal(update.json.label, 'Mock Remote Updated');

    await httpRequest(baseUrl, 'POST', '/api/providers/mock-remote-fixed/set-active');
    const active = await httpRequest(baseUrl, 'GET', '/api/providers');
    assert.equal(active.json.activeProviderId, 'mock-remote-fixed');
  });

  it('secrets PUT does not echo values; GET redacts', async () => {
    const put = await httpRequest(
      baseUrl,
      'PUT',
      '/api/providers/mock-remote-fixed/secrets',
      { apiKey: FIXED_KEY, bearerToken: '' },
    );
    assert.equal(put.status, 200);
    assert.equal(put.json.hasApiKey, true);
    assert.equal(put.json.ok, true);

    const get = await httpRequest(baseUrl, 'GET', '/api/providers/mock-remote-fixed');
    assert.equal(get.json.hasApiKey, true);
    const body = JSON.stringify(get.json);
    assert.equal(body.includes(FIXED_KEY), false);
  });

  it('proxy models forwards Authorization to upstream', async () => {
    lastMockHeaders = {};
    const models = await httpRequest(
      baseUrl,
      'GET',
      '/api/providers/mock-remote-fixed/models',
    );
    assert.equal(models.status, 200);
    assert.ok(models.json.data.some((m) => m.id === 'mock-model-fixed'));
    assert.equal(lastMockHeaders.authorization, `Bearer ${FIXED_KEY}`);
  });

  it('proxy chat forwards POST with auth', async () => {
    lastMockHeaders = {};
    const chat = await httpRequest(
      baseUrl,
      'POST',
      '/api/providers/mock-remote-fixed/chat/completions',
      {
        model: 'mock-model-fixed',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
    );
    assert.equal(chat.status, 200);
    assert.equal(lastMockHeaders.authorization, `Bearer ${FIXED_KEY}`);
  });

  it('rejects deleting last provider', async () => {
    const ids = (await httpRequest(baseUrl, 'GET', '/api/providers')).json.providers.map(
      (p) => p.id,
    );
    for (const id of ids) {
      if (id === 'lm-studio-local') continue;
      await httpRequest(baseUrl, 'DELETE', `/api/providers/${id}`);
    }
    const del = await httpRequest(baseUrl, 'DELETE', '/api/providers/lm-studio-local');
    assert.equal(del.status, 409);
  });
});
