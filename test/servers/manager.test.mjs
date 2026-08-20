/**
 * Managed server manager — install jobs, start/stop, health, auto-start.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { readResource, writeResource } from '../../server/config/store.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import {
  autoProvisionEnabledServers,
  autoStartEnabledServers,
  getServerJob,
  installServer,
  listServers,
  resetInstallProvisionOverrideForTests,
  resetKillTreeWaitOverrideForTests,
  resetManagerFetchOverrideForTests,
  resetManagerSpawnOverrideForTests,
  resetManagerStateForTests,
  setInstallProvisionOverrideForTests,
  setKillTreeWaitOverrideForTests,
  setManagerFetchOverrideForTests,
  setManagerSpawnOverrideForTests,
  startServer,
  stopServer,
} from '../../server/servers/manager.js';
import {
  getServerDir,
  getServerMetaPath,
  getServerRunPath,
  getServerVenvDir,
} from '../../server/servers/paths.js';
import { writeSearxngSettings } from '../../server/servers/searxng.js';
import { createVenv } from '../../server/servers/provisioner.js';

const FIXED_PORT = 17899;
const FIXED_HEALTH_PORT = 17788;

/** Mark SearXNG as installed without downloading bundles. */
async function seedSearxngInstalled() {
  const venvDir = getServerVenvDir('searxng');
  await fsp.rm(venvDir, { recursive: true, force: true });
  const systemPython =
    process.env.SEARXNG_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  await createVenv(systemPython, venvDir);
  const searxInit = path.join(getServerDir('searxng'), 'src', 'searx', '__init__.py');
  await fsp.mkdir(path.dirname(searxInit), { recursive: true });
  await fsp.writeFile(searxInit, '', 'utf8');
  await fsp.mkdir(path.dirname(getServerMetaPath('searxng')), { recursive: true });
  await fsp.writeFile(
    getServerMetaPath('searxng'),
    `${JSON.stringify({
      kind: 'python-venv',
      version: 'e964708c0',
      pythonVersion: '3.12.9',
      sizeBytes: 0,
      installedAt: '2020-01-01T00:00:00.000Z',
    })}\n`,
    'utf8',
  );
}

/** @returns {import('node:child_process').ChildProcess} */
function createMockChild() {
  const listeners = /** @type {Record<string, Array<(...args: unknown[]) => void>>} */ ({});
  const child = {
    pid: 42424,
    exitCode: null,
    signalCode: null,
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on(event, cb) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    },
    once(event, cb) {
      this.on(event, cb);
    },
    removeListener(event, cb) {
      const list = listeners[event];
      if (!list) return;
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    },
    kill(signal) {
      child.exitCode = 0;
      child.signalCode = signal ?? 'SIGTERM';
      for (const cb of listeners.exit ?? []) {
        cb(0, signal);
      }
      for (const cb of listeners.close ?? []) {
        cb();
      }
    },
    emitExit(code = 1) {
      child.exitCode = code;
      for (const cb of listeners.exit ?? []) {
        cb(code);
      }
      for (const cb of listeners.close ?? []) {
        cb();
      }
    },
  };
  return child;
}

describe('server manager', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = path.join(os.tmpdir(), 'minnow-servers-mgr-test');
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
    await ensureMinnowLayout();
  });

  after(async () => {
    resetManagerStateForTests();
    resetManagerSpawnOverrideForTests();
    resetManagerFetchOverrideForTests();
    resetInstallProvisionOverrideForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  afterEach(() => {
    resetManagerStateForTests();
    resetManagerSpawnOverrideForTests();
    resetManagerFetchOverrideForTests();
    resetInstallProvisionOverrideForTests();
    resetKillTreeWaitOverrideForTests();
  });

  it('install job completes when provision override seeds install', async () => {
    setInstallProvisionOverrideForTests(async (_serverId, onProgress) => {
      onProgress?.('mock install step');
      await seedSearxngInstalled();
    });

    const result = await installServer('searxng');
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, false);

    const job = getServerJob('searxng');
    assert.equal(job?.phase, 'done');
    assert.equal(job?.percent, 100);
    assert.equal(job?.message, 'Installed');

    const rows = await listServers();
    const searxng = rows.find((r) => r.id === 'searxng');
    assert.equal(searxng?.installed, true);
  });

  it('install returns alreadyInstalled without re-running provision', async () => {
    await seedSearxngInstalled();
    let provisionCalls = 0;
    setInstallProvisionOverrideForTests(async () => {
      provisionCalls += 1;
    });

    const result = await installServer('searxng');
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(provisionCalls, 0);
    assert.equal(getServerJob('searxng')?.message, 'Already installed');
  });

  it('start transitions to running after health check; stop clears process', async () => {
    await seedSearxngInstalled();
    await writeSearxngSettings(FIXED_HEALTH_PORT);

    const config = await readResource('servers');
    config.searxng.port = FIXED_HEALTH_PORT;
    await writeResource('servers', config);

    setManagerSpawnOverrideForTests(() => createMockChild());
    setManagerFetchOverrideForTests(async (url) => {
      const u = String(url);
      assert.equal(u, `http://127.0.0.1:${FIXED_HEALTH_PORT}/healthz`);
      return { status: 200 };
    });
    setKillTreeWaitOverrideForTests(async (child) => {
      child.kill();
    });

    const start = await startServer('searxng');
    assert.equal(start.ok, true);
    assert.equal(start.port, FIXED_HEALTH_PORT);

    const running = await listServers();
    const row = running.find((s) => s.id === 'searxng');
    assert.equal(row?.running, true);
    assert.equal(row?.phase, 'running');

    const stopped = await stopServer('searxng');
    assert.equal(stopped.wasRunning, true);

    const afterStop = await listServers();
    assert.equal(afterStop.find((s) => s.id === 'searxng')?.running, false);
    assert.equal(afterStop.find((s) => s.id === 'searxng')?.phase, 'stopped');
  });

  it('writes run.json on start and removes it on stop', async () => {
    await seedSearxngInstalled();
    await writeSearxngSettings(FIXED_HEALTH_PORT);

    const config = await readResource('servers');
    config.searxng.port = FIXED_HEALTH_PORT;
    await writeResource('servers', config);

    setManagerSpawnOverrideForTests(() => createMockChild());
    setManagerFetchOverrideForTests(async () => ({ status: 200 }));
    setKillTreeWaitOverrideForTests(async (child) => {
      child.kill();
    });

    await startServer('searxng');
    const runRaw = await fsp.readFile(getServerRunPath('searxng'), 'utf8');
    const run = JSON.parse(runRaw);
    assert.equal(run.pid, 42424);
    assert.equal(run.port, FIXED_HEALTH_PORT);

    await stopServer('searxng');
    await assert.rejects(() => fsp.readFile(getServerRunPath('searxng')), /ENOENT/);
  });

  it('stopServer waits for child exit via kill override', async () => {
    await seedSearxngInstalled();
    await writeSearxngSettings(FIXED_HEALTH_PORT);
    const config = await readResource('servers');
    config.searxng.port = FIXED_HEALTH_PORT;
    await writeResource('servers', config);

    const child = createMockChild();
    let killCalls = 0;
    setManagerSpawnOverrideForTests(() => child);
    setManagerFetchOverrideForTests(async () => ({ status: 200 }));
    setKillTreeWaitOverrideForTests(async (c) => {
      killCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      c.kill('SIGKILL');
    });

    await startServer('searxng');
    await stopServer('searxng');
    assert.equal(killCalls, 1);
    assert.equal(child.exitCode, 0);
  });

  it('startServer throws when child exits during health wait despite fetch 200', async () => {
    await seedSearxngInstalled();
    await writeSearxngSettings(FIXED_HEALTH_PORT);
    const config = await readResource('servers');
    config.searxng.port = FIXED_HEALTH_PORT;
    await writeResource('servers', config);

    const child = createMockChild();
    setManagerSpawnOverrideForTests(() => {
      setImmediate(() => child.emitExit(1));
      return child;
    });
    setManagerFetchOverrideForTests(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { status: 200 };
    });
    setKillTreeWaitOverrideForTests(async (c) => {
      c.kill();
    });

    await assert.rejects(() => startServer('searxng'), /exited during startup/);
  });

  it('autoStartEnabledServers starts only enabled+autoStart+installed', async () => {
    await seedSearxngInstalled();

    const config = await readResource('servers');
    config.searxng.enabled = true;
    config.searxng.autoStart = true;
    config.searxng.port = FIXED_PORT;
    await writeResource('servers', config);
    await writeSearxngSettings(FIXED_PORT);

    const startedIds = [];
    setManagerSpawnOverrideForTests(() => {
      startedIds.push('searxng');
      return createMockChild();
    });
    setManagerFetchOverrideForTests(async () => ({ status: 200 }));

    await autoStartEnabledServers();
    assert.deepEqual(startedIds, ['searxng']);

    const disabled = await readResource('servers');
    disabled.searxng.enabled = false;
    await writeResource('servers', disabled);
    resetManagerStateForTests();
    startedIds.length = 0;

    await autoStartEnabledServers();
    assert.deepEqual(startedIds, []);
  });

  it('autoProvisionEnabledServers installs then starts enabled+autoStart when not installed', async () => {
    await fsp.rm(getServerVenvDir('searxng'), { recursive: true, force: true });
    await fsp.rm(getServerMetaPath('searxng'), { force: true });
    await fsp.rm(path.join(getServerDir('searxng'), 'src', 'searx'), { recursive: true, force: true });

    const config = await readResource('servers');
    config.searxng.enabled = true;
    config.searxng.autoStart = true;
    config.searxng.port = FIXED_PORT;
    await writeResource('servers', config);
    await writeSearxngSettings(FIXED_PORT);

    setInstallProvisionOverrideForTests(async (_serverId, onProgress) => {
      onProgress?.('mock auto-provision step');
      await seedSearxngInstalled();
    });
    setManagerSpawnOverrideForTests(() => createMockChild());
    setManagerFetchOverrideForTests(async () => ({ status: 200 }));

    await autoProvisionEnabledServers();

    const deadline = Date.now() + 10_000;
    let job = getServerJob('searxng');
    let row = (await listServers()).find((s) => s.id === 'searxng');
    while (Date.now() < deadline && (job?.phase !== 'done' || row?.running !== true)) {
      await new Promise((r) => setTimeout(r, 50));
      job = getServerJob('searxng');
      row = (await listServers()).find((s) => s.id === 'searxng');
    }

    assert.equal(job?.phase, 'done');
    assert.equal(row?.installed, true);
    assert.equal(row?.running, true);
  });

  it('forwards mlx-lm supported/installable/reason so Settings can hide off-platform Install', async () => {
    const rows = await listServers();
    const mlx = rows.find((s) => s.id === 'mlx-lm');
    assert.ok(mlx, 'mlx-lm must appear in the managed catalog');
    assert.equal(typeof mlx.supported, 'boolean');
    assert.equal(typeof mlx.installable, 'boolean');
    assert.equal(mlx.supported, mlx.installable);
    const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
    if (!appleSilicon) {
      assert.equal(mlx.installable, false);
      assert.match(String(mlx.reason), /Apple Silicon/);
    }
  });
});
