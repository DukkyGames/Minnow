import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  createConfigTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

describe('config API rules CRUD', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-rules');
    server = createConfigTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  test('GET rules on empty home returns default blob', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/config/rules');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { version: 1, enabled: false, text: '' });
  });

  test('PUT rules round-trip', async () => {
    const payload = {
      version: 1,
      enabled: true,
      text: 'RULES_MARKER_24: use strict TypeScript.',
    };
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/rules', payload);
    assert.equal(put.status, 200);
    assert.equal(put.json.ok, true);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/rules');
    assert.equal(get.status, 200);
    assert.deepEqual(get.json, payload);

    const file = path.join(homeDir, 'rules.json');
    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(onDisk, payload);
  });

  test('PUT rules rejects text over 16 KiB with 413', async () => {
    const big = 'x'.repeat(16 * 1024 + 1);
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/rules', {
      version: 1,
      enabled: true,
      text: big,
    });
    assert.equal(res.status, 413);
    assert.match(String(res.json?.error ?? ''), /exceeds/i);
  });

  test('PUT rules rejects invalid body with 400', async () => {
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/rules', 'not-json-object');
    assert.equal(res.status, 400);
  });
});
