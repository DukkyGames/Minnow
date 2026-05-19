import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  createConfigTestServer,
  httpRequest,
  readFixture,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

describe('config API CRUD', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env);
    server = createConfigTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  test('GET sessions on empty home returns default blob', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/config/sessions');
    assert.equal(res.status, 200);
    assert.equal(res.json.version, 1);
    assert.ok(Array.isArray(res.json.chats));
    assert.ok(res.json.chats.length >= 1);
  });

  test('PUT sessions round-trip matches fixture', async () => {
    const expected = JSON.parse(await readFixture('expected-sessions-state.json'));
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', expected);
    assert.equal(put.status, 200);
    assert.equal(put.json.ok, true);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/sessions');
    assert.equal(get.status, 200);
    assert.deepEqual(get.json, expected);
  });

  test('PUT tools with brave key round-trips', async () => {
    const expected = JSON.parse(await readFixture('expected-tools.json'));
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/tools', expected);
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/tools');
    assert.equal(get.status, 200);
    assert.deepEqual(get.json, expected);
  });

  test('GET system-prompt round-trip', async () => {
    const expected = JSON.parse(await readFixture('expected-system-prompt.json'));
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/system-prompt', expected);
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/system-prompt');
    assert.deepEqual(get.json, expected);
  });

  test('GET file API rejects traversal key', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/config/file?key=..%2F..%2Fetc%2Fpasswd',
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Invalid config path');
  });

  test('written sessions file exists on disk', async () => {
    const file = path.join(homeDir, 'sessions', 'state.json');
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.activeId, '11111111-1111-1111-1111-111111111111');
  });
});
