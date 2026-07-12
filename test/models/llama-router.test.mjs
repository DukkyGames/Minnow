/**
 * llama.cpp router mode — preset INI, router args, provider flags, mock spawn.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  buildLlamaRouterArgs,
  setRouterSupportProbeOverrideForTests,
  resetRouterSupportProbeOverrideForTests,
} from '../../server/models/llama-args.js';
import {
  presetSectionNameFromFilename,
  writeLlamaPresetIni,
} from '../../server/models/llama-preset.js';
import {
  computeModelsMaxFromVram,
  getRouterStatus,
  resetRouterForTests,
  setRouterBackgroundRunOverrideForTests,
  setRouterHealthOverrideForTests,
  startRouter,
  stopRouter,
} from '../../server/models/llama-router.js';
import { getArtifactsDir, getLlamaPresetIniPath } from '../../server/models/paths.js';
import {
  ensureProviderRegistry,
  listProviders,
  LLAMA_CPP_LOCAL_ID,
} from '../../server/providers/store.js';
import {
  resetServesForTests,
  setServeBackgroundRunOverrideForTests,
  setServeHealthOverrideForTests,
  startServe,
} from '../../server/models/serve.js';

describe('llama router', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelPath;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-llama-router-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await resetRouterForTests();
    await resetServesForTests();

    const artifactsDir = path.join(homeDir, 'models', 'artifacts', 'org--demo');
    await fs.mkdir(artifactsDir, { recursive: true });
    modelPath = path.join(artifactsDir, 'demo-model-Q4_K_M.gguf');
    await fs.writeFile(modelPath, 'GGUF');

    const managedRoot = path.join(homeDir, 'models-runtime', 'llama-cpp');
    await fs.mkdir(managedRoot, { recursive: true });
    const binName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    await fs.writeFile(path.join(managedRoot, binName), '');
    await fs.writeFile(
      path.join(managedRoot, 'meta.json'),
      `${JSON.stringify({ variant: 'cpu', version: 'test', path: path.join(managedRoot, binName) })}\n`,
    );

    await fs.writeFile(
      path.join(homeDir, 'llama-cpp.json'),
      `${JSON.stringify({
        defaults: { ctx: 4096, n_gpu_layers: 0 },
        perModel: {
          'demo-model-Q4_K_M': { ctx: 8192 },
        },
        router: { port: 8085, modelsMax: 2 },
      }, null, 2)}\n`,
    );
  });

  after(async () => {
    resetRouterSupportProbeOverrideForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetRouterForTests();
    await resetServesForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('presetSectionNameFromFilename strips .gguf extension', () => {
    assert.equal(presetSectionNameFromFilename('demo-model-Q4_K_M.gguf'), 'demo-model-Q4_K_M');
  });

  test('writeLlamaPresetIni emits global and per-model sections', async () => {
    const presetPath = await writeLlamaPresetIni();
    assert.equal(presetPath, getLlamaPresetIniPath());
    const ini = await fs.readFile(presetPath, 'utf8');
    assert.match(ini, /\[\*\]/);
    assert.match(ini, /\[demo-model-Q4_K_M\]/);
    assert.match(ini, /ctx-size = 4096/);
    assert.match(ini, /ctx-size = 8192/);
    assert.match(ini, /model = /);
  });

  test('buildLlamaRouterArgs has no -m flag and includes router flags', () => {
    const args = buildLlamaRouterArgs({
      port: 8085,
      modelsDir: getArtifactsDir(),
      presetPath: getLlamaPresetIniPath(),
      modelsMax: 2,
    });
    assert.equal(args.includes('-m'), false);
    assert.deepEqual(args, [
      '--host',
      '127.0.0.1',
      '--port',
      '8085',
      '--models-dir',
      getArtifactsDir(),
      '--models-preset',
      getLlamaPresetIniPath(),
      '--models-max',
      '2',
    ]);
  });

  test('computeModelsMaxFromVram applies VRAM tiers', () => {
    assert.equal(computeModelsMaxFromVram({ gpuVramGb: 8 }), 1);
    assert.equal(computeModelsMaxFromVram({ gpuVramGb: 16 }), 2);
    assert.equal(computeModelsMaxFromVram({ gpuVramGb: 32 }), 3);
  });

  test('startRouter mock spawn persists router state', async () => {
    setRouterSupportProbeOverrideForTests(async () => true);
    setRouterBackgroundRunOverrideForTests(async () => ({
      runId: 'router-run-1',
      pid: process.pid,
    }));
    setRouterHealthOverrideForTests(async () => true);

    const status = await startRouter();
    assert.equal(status.status, 'running');
    assert.ok(status.port >= 1024 && status.port <= 65535);
    assert.equal(status.runId, 'router-run-1');
    assert.equal(status.pid, process.pid);

    const raw = await fs.readFile(path.join(homeDir, 'models', 'router-state.json'), 'utf8');
    const saved = JSON.parse(raw);
    assert.equal(saved.status, 'running');
    assert.equal(saved.port, status.port);
    assert.equal(saved.pid, process.pid);

    await stopRouter();
    const stopped = await getRouterStatus();
    assert.equal(stopped.status, 'stopped');
  });

  test('router serve upserts provider with load/unload support', async () => {
    await ensureProviderRegistry();
    setRouterSupportProbeOverrideForTests(async () => true);
    setRouterBackgroundRunOverrideForTests(async () => ({
      runId: 'router-run-2',
      pid: process.pid,
    }));
    setRouterHealthOverrideForTests(async () => true);
    setServeBackgroundRunOverrideForTests(async () => ({
      runId: 'legacy-should-not-run',
      pid: 1,
    }));
    setServeHealthOverrideForTests(async () => true);

    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      modelLabel: 'demo-model-Q4_K_M.gguf',
    });
    assert.equal(serve.status, 'running');
    assert.equal(serve.providerId, LLAMA_CPP_LOCAL_ID);

    const { providers } = await listProviders();
    const llamaProv = providers.find((p) => p.id === LLAMA_CPP_LOCAL_ID);
    assert.equal(llamaProv?.enabled, true);
    assert.equal(llamaProv?.supportsModelLoadUnload, true);
    assert.equal(llamaProv?.modelsLoadPath, '/models/load');
    assert.equal(llamaProv?.modelsUnloadPath, '/models/unload');
  });
});
