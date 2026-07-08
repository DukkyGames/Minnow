/**
 * capability-probe: prioritize, catalog ingest, mock upstream probes.
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
import { prioritizeModelIds } from '../../server/providers/capability-probe.js';

let homeDir;
let baseUrl;
let mockBaseUrl;
let server;
let mockServer;
/** @type {Record<string, number>} */
let probeCallCount = {};

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-cap-probe');
  server = createProviderTestServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;

  mockServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            { id: 'model-z', object: 'model' },
            { id: 'model-a', object: 'model' },
            { id: 'model-loaded', object: 'model' },
          ],
        }),
      );
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        const model = parsed.model;
        probeCallCount[model] = (probeCallCount[model] || 0) + 1;
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
        if (hasTools) {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: 'c1',
                        type: 'function',
                        function: { name: 'probe_noop', arguments: '{}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }),
          );
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = /** @type {import('net').AddressInfo} */ (mockServer.address()).port;
  mockBaseUrl = `http://127.0.0.1:${mockPort}`;

  await httpRequest(baseUrl, 'POST', '/api/providers', {
    id: 'probe-openai',
    label: 'Probe OpenAI',
    baseUrl: mockBaseUrl,
    apiKind: 'openai-v1',
  });
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  if (typeof mockServer.closeAllConnections === 'function') mockServer.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await new Promise((resolve, reject) => {
    mockServer.close((err) => (err ? reject(err) : resolve()));
  });
  await rmTestHome(homeDir);
});

describe('prioritizeModelIds', () => {
  it('orders selected, loaded, then alphabetical and caps at 8', () => {
    const ids = [
      'm-h',
      'm-b',
      'm-a',
      'm-c',
      'm-d',
      'm-e',
      'm-f',
      'm-g',
      'm-i',
      'm-selected',
    ];
    const catalog = [
      { id: 'm-b', state: 'loaded' },
      { id: 'm-a', state: 'not loaded' },
    ];
    const out = prioritizeModelIds(ids, 'm-selected', catalog);
    assert.equal(out[0], 'm-selected');
    assert.equal(out[1], 'm-b');
    assert.equal(out.length, 8);
    assert.ok(out.includes('m-a'));
  });
});

describe('POST capabilities/probe', () => {
  it('writes capabilities.json with tool probe results', async () => {
    probeCallCount = {};
    const res = await httpRequest(
      baseUrl,
      'POST',
      '/api/providers/probe-openai/capabilities/probe',
      { modelIds: ['model-a'] },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.schemaVersion, 1);
    assert.equal(res.json.models['model-a'].tools, true);
    assert.equal(res.json.models['model-a'].streaming, true);

    const get = await httpRequest(
      baseUrl,
      'GET',
      '/api/providers/probe-openai/capabilities',
    );
    assert.equal(get.status, 200);
    assert.equal(get.json.models['model-a'].tools, true);
  });
});
