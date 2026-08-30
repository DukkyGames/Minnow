/**
 * MLX crash propagation — stub manager.subscribeServerState so this runs on Windows.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/** @type {Array<(event: object) => void>} */
const mlxStateListeners = [];
const startServerCalls = [];

mock.module('../../server/servers/manager.js', {
  namedExports: {
    startServer: async (id) => {
      startServerCalls.push(id);
      return { ok: true, alreadyRunning: startServerCalls.length > 1 };
    },
    stopServer: async () => ({ ok: true, wasRunning: true }),
    getManagedServerPort: async () => 8087,
    isManagedServerRunning: () => true,
    subscribeServerState: (serverId, listener) => {
      if (serverId === 'mlx-lm') mlxStateListeners.push(listener);
      return () => {
        const index = mlxStateListeners.indexOf(listener);
        if (index >= 0) mlxStateListeners.splice(index, 1);
      };
    },
  },
});

mock.module('../../server/servers/mlx-lm.js', {
  namedExports: {
    isMlxSupported: () => true,
    getInstallStatus: async () => ({ installed: true }),
    MLX_UNSUPPORTED_MESSAGE: 'MLX runs only on Apple Silicon Macs.',
    MLX_LM_VERSION: '0.31.3',
  },
});

const { resetMinnowHomeCache } = await import('../../server/config/home.js');
const { getServesIndexPath } = await import('../../server/models/paths.js');
const { listServes, resetServesForTests, startServe, setMlxWarmupOverrideForTests, waitForServeCrashHandlersForTests } = await import('../../server/models/serve.js');

describe('MLX serve crash', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string | undefined} */
  let prevHome;
  /** @type {string} */
  let mlxDir;

  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-serve-crash-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    mlxDir = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Crash-4bit');
    await fsp.mkdir(mlxDir, { recursive: true });
    await fsp.writeFile(path.join(mlxDir, 'config.json'), '{"quantization":{"bits":4}}');
  });

  beforeEach(async () => {
    await resetServesForTests();
    mlxStateListeners.length = 0;
    startServerCalls.length = 0;
    setMlxWarmupOverrideForTests(async () => {});
    await fsp.mkdir(path.dirname(getServesIndexPath()), { recursive: true });
    await fsp.writeFile(getServesIndexPath(), `${JSON.stringify({ version: 1, serves: [] }, null, 2)}\n`);
  });

  after(async () => {
    // Drain crash persist before swapping MINNOW_HOME so commitServes cannot hit a deleted path.
    await waitForServeCrashHandlersForTests();
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await resetServesForTests();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('subscribeServerState exit marks mlx-lm rows crashed', async () => {
    const serve = await startServe({
      modelPath: mlxDir,
      runtime: 'mlx-lm',
      modelLabel: mlxDir,
    });
    assert.equal(serve.status, 'running');
    assert.ok(mlxStateListeners.length >= 1, 'serve.js should subscribe for mlx-lm');

    for (const listener of mlxStateListeners) {
      listener({ type: 'exit', code: 1 });
    }

    const deadline = Date.now() + 5_000;
    let row = serve;
    while (Date.now() < deadline) {
      const [next] = await listServes();
      if (next?.status === 'crashed') {
        row = next;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(row.status, 'crashed');
    assert.equal(row.exitCode, 1);
    assert.equal(row.failure?.code, 'unknown');
    assert.equal(row.id, serve.id);
    await waitForServeCrashHandlersForTests();
  });
});
