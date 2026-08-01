/**
 * Non-blocking serve start — the Local Server surface polls a starting model
 * instead of hanging on the request until llama.cpp is healthy.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  getServe,
  resetServesForTests,
  setServeBackgroundRunOverrideForTests,
  setServeHealthOverrideForTests,
  startServe,
  stopServe,
} from '../../server/models/serve.js';

/** Poll getServe until it leaves 'starting', or give up. */
async function waitForStatus(serveId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serve = await getServe(serveId);
    if (serve && serve.status !== 'starting') return serve;
    await new Promise((r) => setTimeout(r, 25));
  }
  return getServe(serveId);
}

describe('async serve start', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelPath;
  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-serve-async-'));
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
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetServesForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('async:true returns while the model is still loading', async () => {
    // Hold the health probe open so "still loading" is a real state, not a race.
    let releaseHealth;
    const healthGate = new Promise((resolve) => {
      releaseHealth = resolve;
    });
    setServeHealthOverrideForTests(async () => {
      await healthGate;
      return true;
    });

    const serve = await startServe({ modelPath, runtime: 'llama-cpp', async: true });
    assert.equal(serve.status, 'starting');
    assert.equal(serve.runId, 'test-run');

    const pending = await getServe(serve.id);
    assert.equal(pending.status, 'starting', 'still loading right after the call returns');

    releaseHealth();
    const settled = await waitForStatus(serve.id, 8_000);
    assert.equal(settled.status, 'running');
    assert.ok(settled.baseUrl.startsWith('http://127.0.0.1:'));

    await stopServe(serve.id);
  });

  test('a failed async start surfaces the error on the record', async () => {
    setServeHealthOverrideForTests(async () => false);

    const serve = await startServe({ modelPath, runtime: 'llama-cpp', async: true });
    assert.equal(serve.status, 'starting');

    const settled = await waitForStatus(serve.id, 8_000);
    assert.equal(settled.status, 'error');
    assert.match(settled.error, /healthy/i);
  });

  test('the blocking path still throws for callers that did not opt in', async () => {
    setServeHealthOverrideForTests(async () => false);
    await assert.rejects(
      () => startServe({ modelPath, runtime: 'llama-cpp' }),
      /healthy/i,
    );
  });

  test('getServe rejects an id that is not a uuid', async () => {
    await assert.rejects(() => getServe('../etc/passwd'), /Invalid/i);
  });
});
