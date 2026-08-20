/**
 * Prove startServe reads the GGUF header for llama-cpp and threads it into
 * buildLlamaServerArgs. mock.module wraps both modules so we can inspect the
 * call without changing serve-async.test.mjs (which uses a 4-byte GGUF stub).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';

/** Paths readGgufMetadata was asked to parse. */
const ggufReads = [];
/** Distinctive header object startServe must pass through unchanged. */
const FAKE_GGUF_META = {
  arch: 'llama',
  nLayers: 80,
  nKvHeads: 8,
  headDim: 128,
  nEmbd: 4096,
  nVocab: 128256,
};

mock.module('../../server/models/gguf-metadata.js', {
  namedExports: {
    readGgufMetadata: async (filePath) => {
      ggufReads.push(filePath);
      return FAKE_GGUF_META;
    },
  },
});

const llamaArgs = await import('../../server/models/llama-args.js');
/** Last opts object startServe handed to buildLlamaServerArgs. */
let lastBuildOpts = null;

mock.module('../../server/models/llama-args.js', {
  namedExports: {
    getLlamaCppConfigPath: llamaArgs.getLlamaCppConfigPath,
    readLlamaCppConfig: llamaArgs.readLlamaCppConfig,
    writeLlamaCppConfig: llamaArgs.writeLlamaCppConfig,
    buildLlamaServerLaunch: (opts) => {
      lastBuildOpts = opts;
      return llamaArgs.buildLlamaServerLaunch(opts);
    },
    buildLlamaServerArgs: (opts) => {
      lastBuildOpts = opts;
      return llamaArgs.buildLlamaServerArgs(opts);
    },
    warnIfReasoningBudgetCliFlag: llamaArgs.warnIfReasoningBudgetCliFlag,
    findSiblingMmproj: llamaArgs.findSiblingMmproj,
    buildLlamaServerSpawnEnv: llamaArgs.buildLlamaServerSpawnEnv,
  },
});

const { resetMinnowHomeCache } = await import('../../server/config/home.js');
const {
  resetServesForTests,
  setServeBackgroundRunOverrideForTests,
  setServeHealthOverrideForTests,
  startServe,
  stopServe,
} = await import('../../server/models/serve.js');

describe('startServe GGUF metadata', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelPath;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-serve-gguf-'));
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

    setServeBackgroundRunOverrideForTests(async () => ({ runId: 'test-run', pid: 12345 }));
    setServeHealthOverrideForTests(async () => true);
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetServesForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('llama-cpp startServe reads GGUF metadata and passes it to buildLlamaServerArgs', async () => {
    ggufReads.length = 0;
    lastBuildOpts = null;

    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      async: true,
    });
    assert.equal(serve.status, 'starting');

    // validateServeModelTarget also reads the header (split-shard sibling guard).
    // Production `readGgufMetadata` is LRU-cached; this mock is not, so we see both calls.
    assert.ok(ggufReads.length >= 1);
    assert.ok(ggufReads.every((p) => p === modelPath));
    assert.ok(lastBuildOpts);
    assert.equal(lastBuildOpts.ggufMeta, FAKE_GGUF_META);

    await stopServe(serve.id);
  });

  test('empty llama settings store planned auto llamaSettings without 999', async () => {
    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      async: true,
    });
    assert.ok(serve.llamaSettings);
    assert.equal(serve.llamaSettings.fit_mode, 'auto');
    assert.notEqual(serve.llamaSettings.n_gpu_layers, 999);
    assert.ok(serve.llamaSettings.ctx != null);
    await stopServe(serve.id);
  });

  test('manual over-budget startServe appends a fit planner warning to the serve log', async () => {
    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      async: true,
      weightsGb: 5,
      paramsB: 8,
      hardware: { gpuVramGb: 0, availableRamGb: 8, totalRamGb: 8, backend: 'cpu' },
      llama: { fit_mode: 'manual', ctx: 128000, cache_type: 'f16' },
    });
    assert.equal(serve.llamaSettings.fit_mode, 'manual');
    assert.equal(serve.llamaSettings.ctx, 128000);

    const logPath = path.join(homeDir, 'logs', 'models', `${serve.runId}.log`);
    const text = await fs.readFile(logPath, 'utf8');
    assert.match(text, /fit planner/);
    assert.match(text, /warning: you overrode the fit planner/);
    await stopServe(serve.id);
  });
});
