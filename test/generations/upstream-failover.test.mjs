/**
 * Pre-first-token failover and no mid-stream switching tests.
 */

import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';
import http from 'node:http';
import { setTestHome, rmTestHome } from '../config/test-helpers.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { writeConfigJson } from '../../server/config/store.js';
import { createProvider } from '../../server/providers/store.js';
import {
  createGenerationState,
  getGenerationState,
} from '../../server/generations/store.js';
import { pumpUpstream } from '../../server/generations/upstream.js';
import { resetHostCooldownForTests } from '../../server/generations/host-cooldown.js';

let homeDir;
let primaryBaseUrl;
let backupBaseUrl;
let primaryServer;
let backupServer;
let primaryCalls = 0;
let backupCalls = 0;

function waitForTerminal(id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const state = getGenerationState(id);
      if (!state) {
        reject(new Error('missing generation state'));
        return;
      }
      if (state.status === 'complete' || state.status === 'error' || state.status === 'cancelled') {
        resolve(state);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout waiting for terminal status (last=${state.status})`));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-test-fallback-upstream');
  await ensureMinnowLayout();

  primaryServer = http.createServer((req, res) => {
    primaryCalls += 1;
    if (req.method === 'POST') {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('primary unavailable');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  backupServer = http.createServer((req, res) => {
    backupCalls += 1;
    if (req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise((resolve) => primaryServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => backupServer.listen(0, '127.0.0.1', resolve));

  const primaryPort = /** @type {import('net').AddressInfo} */ (primaryServer.address()).port;
  const backupPort = /** @type {import('net').AddressInfo} */ (backupServer.address()).port;
  primaryBaseUrl = `http://127.0.0.1:${primaryPort}`;
  backupBaseUrl = `http://127.0.0.1:${backupPort}`;

  await createProvider({
    id: 'primary-fixed',
    label: 'Primary',
    baseUrl: primaryBaseUrl,
    apiKind: 'openai-v1',
  });
  await createProvider({
    id: 'backup-fixed',
    label: 'Backup',
    baseUrl: backupBaseUrl,
    apiKind: 'openai-v1',
  });

  await writeConfigJson('config.json', {
    fallbackChains: {
      enabled: true,
      cooldownSeconds: 60,
      maxChainLength: 4,
      roles: {
        default: [{ providerId: 'backup-fixed', modelId: '' }],
        utility: [],
        research: [],
        vision: [],
      },
    },
  });
});

after(async () => {
  resetHostCooldownForTests();
  await new Promise((resolve) => primaryServer.close(resolve));
  await new Promise((resolve) => backupServer.close(resolve));
  await rmTestHome(homeDir);
  mock.restoreAll();
});

describe('upstream failover', () => {
  test('retries next candidate before first token when primary refuses connection', async () => {
    resetHostCooldownForTests();
    primaryCalls = 0;
    backupCalls = 0;

    const state = createGenerationState({
      providerId: 'primary-fixed',
      body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      candidates: [
        { providerId: 'primary-fixed', modelId: 'test-model' },
        { providerId: 'backup-fixed', modelId: 'test-model' },
      ],
    });

    pumpUpstream({ state });
    const terminal = await waitForTerminal(state.id);

    assert.equal(terminal.status, 'complete');
    assert.equal(terminal.fallbackUsed, true);
    assert.equal(terminal.chosenProviderId, 'backup-fixed');
    assert.ok(terminal.totalBytes > 0);
    assert.ok(primaryCalls >= 1);
    assert.ok(backupCalls >= 1);
  });

  test('does not switch models after bytes were emitted', async () => {
    resetHostCooldownForTests();
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (!sent) {
                sent = true;
                return { done: false, value: new TextEncoder().encode('data: chunk\n\n') };
              }
              const err = new Error('socket hang up');
              err.code = 'ECONNRESET';
              throw err;
            },
          };
        },
      },
    }));

    const state = createGenerationState({
      providerId: 'primary-fixed',
      body: { model: 'test-model', messages: [] },
      candidates: [{ providerId: 'primary-fixed', modelId: 'test-model' }],
    });

    pumpUpstream({ state });
    const terminal = await waitForTerminal(state.id);

    assert.equal(terminal.fallbackUsed, false);
    assert.equal(terminal.chosenProviderId, 'primary-fixed');
    assert.equal(terminal.status, 'error');
    assert.ok(terminal.totalBytes > 0);
    mock.restoreAll();
  });
});
