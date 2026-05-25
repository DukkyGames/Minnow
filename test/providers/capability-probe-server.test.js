/**
 * Server-side capability probe persistence and route.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  setTestHome,
  rmTestHome,
  createProviderTestServer,
  httpRequest,
} from './test-helpers.js';

let homeDir;
let baseUrl;
let mockBaseUrl;
let server;
let mockServer;
/** @type {Array<{ body: object }>} */
let probeBodies = [];

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-test-cap-probe');
  server = createProviderTestServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;

  mockServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/v0/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'mock-model', type: 'llm', state: 'loaded' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v0/chat/completions') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        const body = JSON.parse(raw);
        probeBodies.push({ body });
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const hasFormat = body.response_format != null;
        if (hasFormat && (!hasTools || probeBodies.filter((p) => p.body.tools?.length).length <= 1)) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
          return;
        }
        if (hasFormat && hasTools && body.stream) {
          res.statusCode = 400;
          res.end('streaming structured output not supported');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      });
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

  await httpRequest(baseUrl, 'POST', '/api/providers', {
    id: 'probe-test',
    label: 'Probe Test',
    baseUrl: mockBaseUrl,
    apiKind: 'lm-studio-v0',
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => mockServer.close(resolve));
  await rmTestHome(homeDir);
});

describe('probe-capabilities route', () => {
  it('POST probe writes capabilities.json', async () => {
    probeBodies = [];
    const res = await httpRequest(
      baseUrl,
      'POST',
      '/api/providers/probe-test/probe-capabilities',
      {},
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.structuredOutput, true);
    assert.equal(res.json.structuredOutputWithTools, true);
    assert.equal(typeof res.json.probedAt, 'string');

    const file = path.join(homeDir, 'providers', 'probe-test', 'capabilities.json');
    const raw = await fs.readFile(file, 'utf8');
    const saved = JSON.parse(raw);
    assert.equal(saved.providerId, 'probe-test');

    const getRes = await httpRequest(
      baseUrl,
      'GET',
      '/api/providers/probe-test/capabilities',
    );
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.structuredOutputWithTools, true);
  });
});
