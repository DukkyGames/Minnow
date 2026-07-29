/**
 * fake-board provider models proxy when the in-process fake host is stopped.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FAKE_PROVIDER_ID } from '../../scripts/fake-model-server.mjs';
import {
  createProviderTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

let homeDir;
let baseUrl;
let server;

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-test-fake-board-proxy');
  server = createProviderTestServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;

  const create = await httpRequest(baseUrl, 'POST', '/api/providers', {
    id: FAKE_PROVIDER_ID,
    label: 'Fake board model',
    baseUrl: 'http://127.0.0.1:18765',
    apiKind: 'openai-v1',
  });
  assert.equal(create.status, 201);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rmTestHome(homeDir);
});

describe('fake-board models proxy', () => {
  test('returns empty catalog when fake host is not running', async () => {
    const res = await httpRequest(baseUrl, 'GET', `/api/providers/${FAKE_PROVIDER_ID}/models`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { data: [] });
  });
});
