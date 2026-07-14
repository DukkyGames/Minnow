/**
 * llama.cpp single-provider serve tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  ensureProviderRegistry,
  listProviders,
  LLAMA_CPP_LOCAL_ID,
  migrateLegacyModelServeProviders,
} from '../../server/providers/store.js';
import {
  resetServesForTests,
  startServe,
  stopServe,
} from '../../server/models/serve.js';
import {
  setRouterSupportProbeOverrideForTests,
  resetRouterSupportProbeOverrideForTests,
} from '../../server/models/llama-args.js';
import {
  resetRouterForTests,
  setRouterBackgroundRunOverrideForTests,
  setRouterHealthOverrideForTests,
} from '../../server/models/llama-router.js';

describe('llama-cpp single provider', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelPath;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-llama-provider-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await resetServesForTests();

    modelPath = path.join(homeDir, 'test-model.gguf');
    await fs.writeFile(modelPath, 'GGUF');

    const managedRoot = path.join(homeDir, 'models-runtime', 'llama-cpp');
    await fs.mkdir(managedRoot, { recursive: true });
    const binName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    await fs.writeFile(path.join(managedRoot, binName), '');
    await fs.writeFile(
      path.join(managedRoot, 'meta.json'),
      `${JSON.stringify({ variant: 'cpu', version: 'test', path: path.join(managedRoot, binName) })}\n`,
    );

    setRouterSupportProbeOverrideForTests(async () => true);
    setRouterBackgroundRunOverrideForTests(async () => ({
      runId: 'router-run-test',
      pid: process.pid,
    }));
    setRouterHealthOverrideForTests(async () => true);
  });

  after(async () => {
    resetRouterSupportProbeOverrideForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetRouterForTests();
    await resetServesForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('migration removes legacy models-* providers', async () => {
    await ensureProviderRegistry();

    const legacyDir = path.join(homeDir, 'providers', 'models-deadbeef');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'profile.json'),
      `${JSON.stringify({
        id: 'models-deadbeef',
        label: 'Models · old.gguf',
        baseUrl: 'http://127.0.0.1:8085',
        apiKind: 'openai-v1',
        enabled: false,
        authStyle: 'bearer',
        modelsPath: '/v1/models',
        chatCompletionsPath: '/v1/chat/completions',
        supportsModelLoadUnload: false,
        customHeaders: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(legacyDir, 'secrets.json'),
      `${JSON.stringify({ apiKey: '', bearerToken: '', headerOverrides: {} })}\n`,
    );

    await migrateLegacyModelServeProviders();
    const { providers } = await listProviders();
    assert.equal(
      providers.some((p) => p.id === 'models-deadbeef'),
      false,
    );
    assert.ok(providers.some((p) => p.id === LLAMA_CPP_LOCAL_ID));
  });

  test('serve upserts llama-cpp-local and disables on stop', async () => {
    const serveA = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      modelLabel: 'test-model.gguf',
    });
    assert.equal(serveA.providerId, LLAMA_CPP_LOCAL_ID);

    let { providers } = await listProviders();
    const llamaProv = providers.find((p) => p.id === LLAMA_CPP_LOCAL_ID);
    assert.ok(llamaProv?.enabled);
    assert.equal(llamaProv?.baseUrl, serveA.baseUrl);
    assert.equal(providers.filter((p) => /^models-[a-f0-9]{8}$/.test(p.id)).length, 0);

    await stopServe(serveA.id);
    ({ providers } = await listProviders());
    const afterStop = providers.find((p) => p.id === LLAMA_CPP_LOCAL_ID);
    assert.equal(afterStop?.enabled, false);
  });

  test('re-serve updates same provider baseUrl', async () => {
    const serveA = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      modelLabel: 'model-a.gguf',
    });
    const serveB = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      modelLabel: 'model-b.gguf',
    });
    assert.equal(serveA.providerId, serveB.providerId);

    const { providers } = await listProviders();
    assert.equal(providers.filter((p) => p.id === LLAMA_CPP_LOCAL_ID).length, 1);
    const llamaProv = providers.find((p) => p.id === LLAMA_CPP_LOCAL_ID);
    assert.equal(llamaProv?.baseUrl, serveB.baseUrl);
    assert.equal(llamaProv?.enabled, true);
  });
});
