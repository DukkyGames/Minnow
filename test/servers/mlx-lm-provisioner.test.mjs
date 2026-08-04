/**
 * mlx-lm provisioner — spawn arguments, the Apple Silicon gate, and the
 * install-status guard.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { getServerDef } from '../../server/servers/catalog.js';
import {
  buildMlxServerArgs,
  getInstallStatus,
  isMlxSupported,
  MLX_LM_VERSION,
  MLX_UNSUPPORTED_MESSAGE,
  provision,
} from '../../server/servers/mlx-lm.js';
import { getServerMetaPath, getServerVenvDir } from '../../server/servers/paths.js';

describe('mlx-lm spawn arguments', () => {
  test('never pins --model', () => {
    // The whole point of the managed server: one process hosts every model and
    // switching is a request, not a restart. A --model here undoes that.
    assert.equal(buildMlxServerArgs(8087).includes('--model'), false);
  });

  test('binds loopback and names an explicit allowed origin', () => {
    const args = buildMlxServerArgs(8087);
    assert.deepEqual(args.slice(0, 6), [
      '-m',
      'mlx_lm.server',
      '--host',
      '127.0.0.1',
      '--port',
      '8087',
    ]);

    const originIndex = args.indexOf('--allowed-origins');
    assert.ok(originIndex > -1, 'allowed origins must be passed, not left at the "*" default');
    assert.equal(args[originIndex + 1], 'http://127.0.0.1');
    assert.notEqual(args[originIndex + 1], '*');
  });

  test('renders the port as a string argument', () => {
    const args = buildMlxServerArgs(9999);
    assert.equal(args[args.indexOf('--port') + 1], '9999');
  });
});

describe('mlx-lm catalog registration', () => {
  test('is a python-venv server so startServer will spawn it', () => {
    const def = getServerDef('mlx-lm');
    assert.ok(def, 'mlx-lm must be registered in BUILTIN_SERVERS');
    // 'native-binary' makes startServer() throw before it ever spawns.
    assert.equal(def.kind, 'python-venv');
    assert.equal(def.healthPath, '/v1/models');
    // Holds a whole model resident in RAM — it starts on demand, not at boot.
    assert.equal(def.defaultAutoStart, false);
  });

  test('does not collide with the other managed server ports', () => {
    const mlx = getServerDef('mlx-lm');
    assert.notEqual(mlx.defaultPort, getServerDef('searxng').defaultPort);
    assert.notEqual(mlx.defaultPort, getServerDef('llama-cpp').defaultPort);
    // 8080 is the upstream default and collides with everything.
    assert.notEqual(mlx.defaultPort, 8080);
  });

  test('pins an mlx-lm version', () => {
    assert.match(MLX_LM_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe('mlx-lm platform gate', () => {
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

  test('isMlxSupported tracks the running platform', () => {
    if (!appleSilicon) {
      assert.equal(isMlxSupported(), false);
      return;
    }
    // On Apple Silicon it still depends on the macOS major version.
    const major = Number.parseInt(os.release().split('.')[0] ?? '', 10);
    assert.equal(isMlxSupported(), major >= 22);
  });

  test('provision refuses rather than letting pip install a runtime without mlx', async () => {
    if (isMlxSupported()) {
      // Provisioning for real would download hundreds of megabytes; the gate is
      // what this test is about and it does not apply here.
      return;
    }
    // `pip install mlx-lm` *succeeds* off darwin — mlx is declared
    // platform-conditional, so pip silently drops it and the failure only
    // surfaces at first inference. The refusal has to be ours.
    await assert.rejects(() => provision(), (err) => {
      assert.equal(err.message, MLX_UNSUPPORTED_MESSAGE);
      return true;
    });
  });
});

describe('mlx-lm install status', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string | undefined} */
  let prevHome;

  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-status-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('reports not installed on a clean home', async () => {
    const status = await getInstallStatus();
    assert.equal(status.installed, false);
    assert.equal(status.version, null);
  });

  test('a venv without a completed-install marker is not installed', async () => {
    // ensureHealthyVenv creates the venv long before pip finishes, so a
    // venv-only check would call a half-installed runtime ready to serve.
    await fsp.mkdir(getServerVenvDir('mlx-lm'), { recursive: true });
    await fsp.writeFile(path.join(getServerVenvDir('mlx-lm'), 'pyvenv.cfg'), 'home = /fake\n');

    const status = await getInstallStatus();
    assert.equal(status.installed, false);
  });

  test('a meta marker without a working venv is not installed either', async () => {
    await fsp.rm(getServerVenvDir('mlx-lm'), { recursive: true, force: true });
    await fsp.mkdir(path.dirname(getServerMetaPath('mlx-lm')), { recursive: true });
    await fsp.writeFile(
      getServerMetaPath('mlx-lm'),
      JSON.stringify({ version: MLX_LM_VERSION, installedAt: new Date().toISOString() }),
    );

    const status = await getInstallStatus();
    assert.equal(status.installed, false);
  });
});
