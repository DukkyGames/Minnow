/**
 * prompt-configs API CRUD against temp SPEEDCHAT_HOME.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { after, before, describe, test } from 'node:test';
import { resetSpeedChatHomeCache } from '../../server/config/home.js';
import { handleConfigRequest } from '../../server/config/middleware.js';
import { handlePromptRequest } from '../../server/prompt-configs/middleware.js';

function setTestHome(env) {
  resetSpeedChatHomeCache();
  const dir = path.join(os.tmpdir(), `speedchat-prompt-test-${process.pid}`);
  env.SPEEDCHAT_HOME = dir;
  return dir;
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleConfigRequest(req, res, url.pathname).then((handled) => {
      if (handled) return;
      void handlePromptRequest(req, res, url.pathname).then((h2) => {
        if (!h2) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });
  });
}

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('prompt-configs API', () => {
  let server;
  let baseUrl;

  before(async () => {
    setTestHome(process.env);
    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    resetSpeedChatHomeCache();
  });

  test('PUT and GET round-trip', async () => {
    const config = {
      id: 'my-debug-setup',
      label: 'Debug minimal',
      profile: 'custom',
      parts: {
        base: { enabled: true, contentOverride: null },
        'tool-usage': {
          enabled: true,
          contentOverride: 'Use tools sparingly.',
        },
      },
    };
    const put = await httpRequest(baseUrl, 'PUT', '/api/prompt-configs/my-debug-setup', config);
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/prompt-configs/my-debug-setup');
    assert.equal(get.status, 200);
    assert.equal(get.json.id, 'my-debug-setup');
    assert.equal(get.json.parts['tool-usage'].contentOverride, 'Use tools sparingly.');
  });

  test('invalid config rejected', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/prompt-configs/bad', {
      id: 'bad',
      label: '',
      profile: 'custom',
      parts: {},
    });
    assert.equal(put.status, 500);
  });

  test('duplicate creates new file', async () => {
    await httpRequest(baseUrl, 'PUT', '/api/prompt-configs/source-a', {
      id: 'source-a',
      label: 'Source',
      profile: 'custom',
      parts: { base: { enabled: true, contentOverride: null } },
    });
    const dup = await httpRequest(
      baseUrl,
      'POST',
      '/api/prompt-configs/source-a/duplicate',
      { newId: 'source-b', newLabel: 'Copy' },
    );
    assert.equal(dup.status, 200);
    const list = await httpRequest(baseUrl, 'GET', '/api/prompt-configs');
    const ids = list.json.configs.map((c) => c.id);
    assert.ok(ids.includes('source-b'));
  });
});
