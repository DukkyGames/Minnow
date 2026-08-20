/**
 * startServe merges saved launch prefs between llama-cpp.json defaults and
 * body.llama so a picker / CLI load with libraryId still gets the last ctx/ngl.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { getLaunchPrefs, setLibraryLaunchSettings } from '../../server/models/launch-prefs.js';
import {
  getServe,
  resetServesForTests,
  setServeBackgroundRunOverrideForTests,
  setServeHealthOverrideForTests,
  startServe,
  stopServe,
} from '../../server/models/serve.js';

const LIB_DEMO = 'lib-demo-8b';

/** Poll getServe until it leaves 'starting', or give up. */
async function waitForStatus(serveId, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serve = await getServe(serveId);
    if (serve && serve.status !== 'starting') return serve;
    await new Promise((r) => setTimeout(r, 25));
  }
  return getServe(serveId);
}

describe('startServe launch prefs merge', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelPath;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-serve-launch-prefs-'));
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

  test('saved manual prefs apply ctx/ngl when body.llama is {}', async () => {
    await setLibraryLaunchSettings(LIB_DEMO, {
      fit_mode: 'manual',
      ctx: 8192,
      n_gpu_layers: 12,
      cache_type: 'q8_0',
    });

    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      libraryId: LIB_DEMO,
      llama: {},
      async: true,
    });
    assert.equal(serve.llamaSettings.fit_mode, 'manual');
    assert.equal(serve.llamaSettings.ctx, 8192);
    assert.equal(serve.llamaSettings.n_gpu_layers, 12);
    assert.equal(serve.llamaSettings.cache_type, 'q8_0');

    const settled = await waitForStatus(serve.id);
    assert.equal(settled.status, 'running');

    const prefs = await getLaunchPrefs();
    assert.ok(Number.isFinite(prefs.byLibraryId[LIB_DEMO].lastLoadMs));
    assert.ok(prefs.byLibraryId[LIB_DEMO].lastLoadMs >= 0);
    // 4-byte GGUF stub used by this suite.
    assert.equal(prefs.byLibraryId[LIB_DEMO].lastWeightsBytes, 4);
    // Slider fields must survive the prior write.
    assert.equal(prefs.byLibraryId[LIB_DEMO].ctx, 8192);

    await stopServe(serve.id);
  });

  test('request body.llama wins over saved prefs', async () => {
    await setLibraryLaunchSettings(LIB_DEMO, {
      fit_mode: 'manual',
      ctx: 8192,
      n_gpu_layers: 12,
      cache_type: 'q8_0',
    });

    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      libraryId: LIB_DEMO,
      llama: { fit_mode: 'manual', ctx: 4096, n_gpu_layers: 4, cache_type: 'f16' },
      async: true,
    });
    assert.equal(serve.llamaSettings.ctx, 4096);
    assert.equal(serve.llamaSettings.n_gpu_layers, 4);
    assert.equal(serve.llamaSettings.cache_type, 'f16');
    await waitForStatus(serve.id);
    await stopServe(serve.id);
  });
});
