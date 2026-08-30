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

  test('GET rules on empty home returns default v2 blob', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/config/rules');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      version: 2,
      enabled: false,
      groups: [{ id: 'general', name: 'General' }],
      rules: [],
    });
  });

  test('PUT rules round-trip with grouped items', async () => {
    const payload = {
      version: 2,
      enabled: true,
      groups: [
        { id: 'general', name: 'General' },
        { id: 'style', name: 'Style' },
      ],
      rules: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'TypeScript',
          text: 'RULES_MARKER_24: use strict TypeScript.',
          enabled: true,
          groupId: 'general',
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          title: 'Diff size',
          text: 'Prefer small diffs.',
          enabled: false,
          groupId: 'style',
        },
      ],
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

  test('PUT rules can drop an empty group without touching other groups\' rules', async () => {
    const withEmptyGroup = {
      version: 2,
      enabled: true,
      groups: [
        { id: 'general', name: 'General' },
        { id: 'style', name: 'Style' },
      ],
      rules: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'TypeScript',
          text: 'RULES_MARKER_24: use strict TypeScript.',
          enabled: true,
          groupId: 'general',
        },
      ],
    };
    const created = await httpRequest(baseUrl, 'PUT', '/api/config/rules', withEmptyGroup);
    assert.equal(created.status, 200);

    const withoutStyle = {
      version: 2,
      enabled: true,
      groups: [{ id: 'general', name: 'General' }],
      rules: withEmptyGroup.rules,
    };
    const removed = await httpRequest(baseUrl, 'PUT', '/api/config/rules', withoutStyle);
    assert.equal(removed.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/rules');
    assert.equal(get.status, 200);
    assert.deepEqual(get.json, withoutStyle);

    const file = path.join(homeDir, 'rules.json');
    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(onDisk, withoutStyle);
  });

  test('PUT legacy v1 rules migrates to v2 on write', async () => {
    const legacy = {
      version: 1,
      enabled: true,
      text: 'Legacy standing instruction.',
    };
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/rules', legacy);
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/rules');
    assert.equal(get.status, 200);
    assert.equal(get.json.version, 2);
    assert.equal(get.json.enabled, true);
    assert.equal(get.json.groups.length, 1);
    assert.equal(get.json.rules.length, 1);
    assert.equal(get.json.rules[0].text, 'Legacy standing instruction.');
    assert.equal(get.json.rules[0].groupId, 'general');
  });

  test('PUT rules rejects combined text over 16 KiB with 413', async () => {
    const big = 'x'.repeat(16 * 1024 + 1);
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/rules', {
      version: 2,
      enabled: true,
      groups: [{ id: 'general', name: 'General' }],
      rules: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'Too big',
          text: big,
          enabled: true,
          groupId: 'general',
        },
      ],
    });
    assert.equal(res.status, 413);
    assert.match(String(res.json?.error ?? ''), /exceeds/i);
  });

  test('PUT rules rejects invalid body with 400', async () => {
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/rules', 'not-json-object');
    assert.equal(res.status, 400);
  });
});
