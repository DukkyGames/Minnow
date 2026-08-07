/**
 * MLX serve lifecycle — provider registration without a spawn.
 *
 * Loading an MLX model is not a process launch: mlx_lm.server is already up and
 * hosting every model, so `startServe` only has to make sure it is running and
 * point the provider at it. Two things this asserts that regressed easily:
 * the `.gguf` file check must not fire for a directory target, and no background
 * run may be created (there is no spawn log, so a runId would strand the load
 * poller on a 404).
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/** Calls into the managed-server manager, so the test can assert idempotence. */
const startServerCalls = [];
const stopServerCalls = [];
let mlxInstalled = true;

mock.module('../../server/servers/manager.js', {
  namedExports: {
    startServer: async (id) => {
      startServerCalls.push(id);
      return { ok: true, alreadyRunning: startServerCalls.length > 1 };
    },
    stopServer: async (id) => {
      stopServerCalls.push(id);
      return { ok: true, wasRunning: true };
    },
    getManagedServerPort: async () => 8087,
    isManagedServerRunning: () => true,
  },
});

mock.module('../../server/servers/mlx-lm.js', {
  namedExports: {
    isMlxSupported: () => true,
    getInstallStatus: async () => ({ installed: mlxInstalled }),
    MLX_UNSUPPORTED_MESSAGE: 'MLX runs only on Apple Silicon Macs.',
  },
});

const { resetMinnowHomeCache } = await import('../../server/config/home.js');
const {
  listServes,
  resetServesForTests,
  setServeBackgroundRunOverrideForTests,
  startServe,
  stopServe,
} = await import('../../server/models/serve.js');
const { listProviders } = await import('../../server/providers/store.js');

/** @type {string} */
let homeDir;
/** @type {string | undefined} */
let prevHome;
/** @type {string} */
let mlxDir;
let backgroundRuns = 0;

describe('MLX serve', () => {
  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-serve-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();

    mlxDir = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Qwen3-8B-4bit');
    await fsp.mkdir(mlxDir, { recursive: true });
    await fsp.writeFile(path.join(mlxDir, 'config.json'), '{"quantization":{"bits":4}}');
    await fsp.writeFile(path.join(mlxDir, 'model.safetensors'), Buffer.alloc(128));

    setServeBackgroundRunOverrideForTests(() => {
      backgroundRuns += 1;
      return { runId: 'should-never-happen' };
    });
  });

  beforeEach(async () => {
    await resetServesForTests();
    startServerCalls.length = 0;
    stopServerCalls.length = 0;
    backgroundRuns = 0;
    mlxInstalled = true;
    // resetServesForTests clears the spawn override, so reinstate it.
    setServeBackgroundRunOverrideForTests(() => {
      backgroundRuns += 1;
      return { runId: 'should-never-happen' };
    });
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await resetServesForTests();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('serves a directory target without tripping the .gguf check', async () => {
    const serve = await startServe({
      modelPath: mlxDir,
      runtime: 'mlx-lm',
      modelLabel: mlxDir,
    });

    assert.equal(serve.runtime, 'mlx-lm');
    assert.equal(serve.status, 'running');
    assert.equal(serve.modelPath, mlxDir);
    assert.equal(serve.port, 8087);
    assert.equal(serve.baseUrl, 'http://127.0.0.1:8087');
  });

  test('never creates a background run', async () => {
    await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    // A runId would make the client poll a spawn log that does not exist.
    assert.equal(backgroundRuns, 0);
    const [serve] = await listServes();
    assert.equal(serve.runId ?? null, null);
  });

  test('registers the shared mlx-lm-local provider and enables it', async () => {
    const serve = await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    assert.equal(serve.providerId, 'minnow-library');

    const { providers } = await listProviders();
    const provider = providers.find((p) => p.id === 'mlx-lm-local');
    assert.ok(provider, 'expected an mlx-lm-local provider row');
    assert.equal(provider.enabled, true);
    assert.equal(provider.apiKind, 'openai-v1');
    assert.equal(provider.baseUrl, 'http://127.0.0.1:8087');
  });

  test('ensures the managed server is up before registering', async () => {
    await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    assert.deepEqual(startServerCalls, ['mlx-lm']);
  });

  test('a second model is a request, not a restart', async () => {
    const other = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Llama-3B-4bit');
    await fsp.mkdir(other, { recursive: true });
    await fsp.writeFile(path.join(other, 'config.json'), '{"quantization":{"bits":4}}');

    const first = await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    const second = await startServe({ modelPath: other, runtime: 'mlx-lm', modelLabel: other });

    const serves = await listServes();
    const firstRow = serves.find((s) => s.id === first.id);
    assert.equal(firstRow?.status, 'stopped');

    // Same process, same provider, same port — only the model key differs.
    assert.equal(first.port, second.port);
    assert.equal(first.providerId, second.providerId);
    assert.notEqual(first.modelLabel, second.modelLabel);
    assert.equal(backgroundRuns, 0);
  });

  test('keeps the provider enabled while another MLX serve is still running', async () => {
    const other = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Llama-3B-4bit');
    await fsp.mkdir(other, { recursive: true });

    const first = await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    await startServe({ modelPath: other, runtime: 'mlx-lm', modelLabel: other });
    await stopServe(first.id);

    const { providers } = await listProviders();
    assert.equal(providers.find((p) => p.id === 'mlx-lm-local')?.enabled, true);
  });

  test('stops the managed server when the last MLX serve is ejected', async () => {
    const serve = await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    await stopServe(serve.id);
    assert.deepEqual(stopServerCalls, ['mlx-lm']);
  });

  test('does not stop the managed server while another MLX serve is active', async () => {
    const other = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Llama-3B-4bit');
    await fsp.mkdir(other, { recursive: true });

    const first = await startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir });
    await startServe({ modelPath: other, runtime: 'mlx-lm', modelLabel: other });
    stopServerCalls.length = 0;
    await stopServe(first.id);
    assert.equal(stopServerCalls.length, 0);
  });

  test('rejects a model directory that is not there', async () => {
    await assert.rejects(
      () =>
        startServe({
          modelPath: path.join(homeDir, 'models', 'artifacts', 'nope'),
          runtime: 'mlx-lm',
          modelLabel: 'nope',
        }),
      /MLX model directory not found/,
    );
  });

  test('refuses to serve when the runtime is not installed', async () => {
    mlxInstalled = false;
    await assert.rejects(
      () => startServe({ modelPath: mlxDir, runtime: 'mlx-lm', modelLabel: mlxDir }),
      /not installed/,
    );
  });
});
