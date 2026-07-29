/**
 * GET/PUT /api/config/issues-taxonomy — resource route must be registered (not 404).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  createConfigTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

let homeDir;
let baseUrl;
let server;

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-test-issues-taxonomy');
  server = createConfigTestServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rmTestHome(homeDir);
});

describe('issues-taxonomy config API', () => {
  test('GET returns default taxonomy when file is missing', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/config/issues-taxonomy');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.types));
    assert.ok(Array.isArray(res.json.statuses));
    assert.ok(Array.isArray(res.json.priorities));
  });

  test('PUT round-trips custom taxonomy', async () => {
    const payload = {
      version: 1,
      types: [{ id: 'bug', label: 'Bug', color: '#f00' }],
      statuses: [{ id: 'open', label: 'Open', category: 'open' }],
      priorities: [{ id: 'p1', label: 'High', rank: 1 }],
    };
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/issues-taxonomy', payload);
    assert.equal(put.status, 200);
    assert.equal(put.json.ok, true);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/issues-taxonomy');
    assert.equal(get.status, 200);
    assert.equal(get.json.types[0]?.id, 'bug');
  });
});
