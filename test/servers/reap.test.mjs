/**
 * Orphan managed-server reaper (run.json + PID verification).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../server/config/home.js';
import { createVenv } from '../../server/servers/provisioner.js';
import { reapOrphanedServers } from '../../server/servers/manager.js';
import { getServerRunPath, getServerVenvDir } from '../../server/servers/paths.js';

/** @param {number} pid */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Long-lived child for reap tests. */
function spawnLongRunner() {
  if (process.platform === 'win32') {
    return spawn('ping', ['-t', '127.0.0.1'], { detached: true, stdio: 'ignore', windowsHide: true });
  }
  return spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
}

describe('reap orphaned managed servers', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = path.join(os.tmpdir(), 'minnow-servers-reap-test');
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
    await ensureMinnowLayout();
    const venvDir = getServerVenvDir('searxng');
    await fsp.rm(venvDir, { recursive: true, force: true });
    const systemPython =
      process.env.SEARXNG_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    await createVenv(systemPython, venvDir);
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('deletes run.json when the recorded PID is not alive', async () => {
    const runPath = getServerRunPath('searxng');
    await fsp.mkdir(path.dirname(runPath), { recursive: true });
    await fsp.writeFile(
      runPath,
      `${JSON.stringify({ pid: 9_999_999, command: 'stale', port: 8899, startedAt: 0 })}\n`,
      'utf8',
    );

    await reapOrphanedServers();
    await assert.rejects(() => fsp.readFile(runPath), /ENOENT/);
  });

  it('deletes run.json without killing when the live command does not match our venv', async () => {
    const child = spawnLongRunner();
    child.unref();
    const pid = child.pid;
    assert.ok(pid);

    const runPath = getServerRunPath('searxng');
    const venvDir = getServerVenvDir('searxng');
    await fsp.mkdir(path.dirname(runPath), { recursive: true });
    await fsp.writeFile(
      runPath,
      `${JSON.stringify({
        pid,
        port: 8899,
        startedAt: Date.now(),
        command: `${venvDir}/bin/python -m fake.module`,
      })}\n`,
      'utf8',
    );

    await reapOrphanedServers();
    await assert.rejects(() => fsp.readFile(runPath), /ENOENT/);
    assert.equal(isPidAlive(pid), true);

    try {
      process.kill(pid);
    } catch {
      /* already exited */
    }
  });

  it('kills a matching orphan and deletes run.json', async () => {
    const venvDir = getServerVenvDir('searxng');
    const python =
      process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python3');
    const child = spawn(python, ['-c', 'import time; time.sleep(60)'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    const pid = child.pid;
    assert.ok(pid);

    const runPath = getServerRunPath('searxng');
    await fsp.mkdir(path.dirname(runPath), { recursive: true });
    await fsp.writeFile(
      runPath,
      `${JSON.stringify({
        pid,
        port: 8899,
        startedAt: Date.now(),
        command: `${python} -c import time`,
      })}\n`,
      'utf8',
    );

    await reapOrphanedServers();
    await assert.rejects(() => fsp.readFile(runPath), /ENOENT/);

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && isPidAlive(pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(isPidAlive(pid), false);
  });
});
