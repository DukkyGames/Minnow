/**
 * MLX serve rows reconcile against managed process ownership, not HTTP alone.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';

let managedMlxRunning = true;

mock.module('../../server/servers/manager.js', {
  namedExports: {
    startServer: async () => ({ ok: true }),
    stopServer: async () => ({ ok: true, wasRunning: false }),
    getManagedServerPort: async () => 8087,
    isManagedServerRunning: () => managedMlxRunning,
    subscribeServerState: () => () => {},
  },
});

mock.module('../../server/servers/mlx-lm.js', {
  namedExports: {
    isMlxSupported: () => true,
    getInstallStatus: async () => ({ installed: true }),
    MLX_UNSUPPORTED_MESSAGE: 'MLX runs only on Apple Silicon Macs.',
  },
});

const { resetMinnowHomeCache } = await import('../../server/config/home.js');
const { getServesIndexPath } = await import('../../server/models/paths.js');
const { listServes, resetServesForTests } = await import('../../server/models/serve.js');

/** @type {string} */
let homeDir;
/** @type {string | undefined} */
let prevHome;

describe('MLX serve reconcile', () => {
  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-serve-reconcile-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await fsp.mkdir(path.dirname(getServesIndexPath()), { recursive: true });
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await resetServesForTests();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('mlx-lm row reconciles to stopped when managed process is not running', async () => {
    await resetServesForTests();
    managedMlxRunning = false;

    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      runtime: 'mlx-lm',
      modelPath: '/tmp/model',
      modelLabel: 'model',
      port: 8087,
      baseUrl: 'http://127.0.0.1:8087',
      providerId: 'minnow-library',
      status: 'running',
      startedAt: 1_700_000_000_000,
    };
    await fsp.writeFile(
      getServesIndexPath(),
      `${JSON.stringify({ version: 1, serves: [row] }, null, 2)}\n`,
      'utf8',
    );

    const serves = await listServes();
    assert.equal(serves.length, 1);
    assert.equal(serves[0].status, 'stopped');
    assert.ok(serves[0].stoppedAt);
  });
});
