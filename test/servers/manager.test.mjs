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
  autoStartEnabledServers,
  getServerJob,
  installServer,
  listServers,
  resetInstallProvisionOverrideForTests,
  resetManagerFetchOverrideForTests,
  resetManagerSpawnOverrideForTests,
  resetManagerStateForTests,
  setInstallProvisionOverrideForTests,
  setManagerFetchOverrideForTests,
  setManagerSpawnOverrideForTests,
  startServer,
  stopServer,
} from '../../server/servers/manager.js';
import {
  getServerDir,
  getServerMetaPath,
  getServerVenvDir,
} from '../../server/servers/paths.js';
import { writeSearxngSettings } from '../../server/servers/searxng.js';

const FIXED_PORT = 8899;
const FIXED_HEALTH_PORT = 7788;

/** @returns {string} */
function venvPythonPath(serverId) {
  const venvDir = getServerVenvDir(serverId);
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3');
}

/** Mark SearXNG as installed without downloading bundles. */
async function seedSearxngInstalled() {
  const python = venvPythonPath('searxng');
  await fsp.mkdir(path.dirname(python), { recursive: true });
  await fsp.writeFile(python, '', 'utf8');
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
  return {
    pid: 42424,
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on(event, cb) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    },
    kill() {
      for (const cb of listeners.exit ?? []) {
        cb(0);
      }
    },
  };
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
});
