/**
 * capabilities routes: GET defaults, 404 provider.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTestHome, rmTestHome, createProviderTestServer, httpRequest } from './test-helpers.js';

let homeDir;
let baseUrl;
let server;

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-cap-routes');
  server = createProviderTestServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rmTestHome(homeDir);
});

describe('capabilities routes', () => {
  it('GET capabilities for seeded lm-studio-local', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/providers/lm-studio-local/capabilities',
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.schemaVersion, 1);
    assert.ok(res.json.models);
  });

  it('GET capabilities 404 for unknown provider', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/providers/no-such-provider/capabilities',
    );
    assert.equal(res.status, 404);
  });
});
