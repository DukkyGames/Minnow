/**
 * MIN-559: the harness must not lose track of commands once the in-memory run
 * map is evicted (60s after finish) or wiped by a host restart.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMinnowLayout, getMinnowHome } from '../../server/config/home.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';
import {
  createBackgroundRun,
  createRun,
  listKnownActiveRuns,
  readCommandLogSnapshot,
  stopActiveRun,
  waitForRun,
} from '../../server/terminal-runner.js';
import {
  isPidAlive,
  readRunIndexEntry,
  resetRunIndexReconcileForTests,
  updateRunIndexEntry,
} from '../../server/terminal/run-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const isWin = process.platform === 'win32';

/** Drop a run from terminal-runner's map the way the 60s eviction timer does. */
async function evict(runId) {
  const runner = await import('../../server/terminal-runner.js');
  // The map is module-private; reach it through the only handle that exposes it.
  return runner.__evictForTests?.(runId);
}

describe('MIN-559 durable run index', () => {
  let homeDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-run-index');
    resetRunIndexReconcileForTests();
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  it('creates the log file at spawn, before any output', async () => {
    const started = await createBackgroundRun({
      command: isWin
        ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30',
      cwd: repoRoot,
      shell: isWin,
      source: 'agent',
      logSubdir: 'terminal',
    });

    // Silent command: nothing has been appended, but the advertised path must exist.
    const abs = path.join(getMinnowHome(), started.logPath);
    await assert.doesNotReject(fs.stat(abs));

    await stopActiveRun(started.runId);
  });

  it('keeps the exit code after the run is evicted from memory', async () => {
    const { runId } = await createRun({
      command: isWin ? 'cmd /c exit 3' : 'sh -c "exit 3"',
      cwd: repoRoot,
      shell: isWin,
      source: 'agent',
    });
    await waitForRun(runId);

    await evict(runId);

    const snapshot = await readCommandLogSnapshot(runId);
    assert.equal(snapshot.found, true);
    assert.equal(snapshot.finished, true);
    // Pre-fix this read back as null once the in-memory state was gone.
    assert.equal(snapshot.exitCode, 3);
  });

  it('distinguishes an unknown run_id from a finished one', async () => {
    const snapshot = await readCommandLogSnapshot('no-such-run-id');
    assert.equal(snapshot.found, false);
    assert.match(snapshot.error, /unknown run_id/);
  });

  it('finds the log of a non-terminal logSubdir after eviction', async () => {
    const started = await createBackgroundRun({
      command: isWin ? 'cmd /c echo hello-dev' : 'sh -c "echo hello-dev"',
      cwd: repoRoot,
      shell: isWin,
      source: 'agent',
      logSubdir: 'dev-server',
    });

    await new Promise((r) => setTimeout(r, 600));
    await evict(started.runId);

    // The old fallback guessed logs/terminal/<runId>.log and came back empty.
    const snapshot = await readCommandLogSnapshot(started.runId);
    assert.equal(snapshot.found, true);
    assert.equal(snapshot.logPath, `logs/dev-server/${started.runId}.log`);
    assert.match(snapshot.output, /hello-dev/);
  });

  it('lists a still-alive run recorded by a previous host process', async () => {
    // Stand in for a run this process never spawned: a live pid, a foreign hostPid.
    const survivor = await createBackgroundRun({
      command: isWin
        ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30',
      cwd: repoRoot,
      shell: isWin,
      source: 'agent',
      logSubdir: 'terminal',
    });
    const entry = await readRunIndexEntry(survivor.runId);
    assert.ok(entry);
    assert.ok(isPidAlive(entry.pid));

    await updateRunIndexEntry(survivor.runId, { hostPid: entry.hostPid + 100_000 });
    await evict(survivor.runId);
    // A fresh host process: empty in-memory map, index reconciled at first access.
    resetRunIndexReconcileForTests();

    const runs = await listKnownActiveRuns({ source: 'agent' });
    const found = runs.find((r) => r.runId === survivor.runId);
    assert.ok(found, 'run started by a previous host should still be listed');
    assert.equal(found.orphaned, true);

    // Refuse to kill by a pid we only know from a stale record, but say why.
    const stopped = await stopActiveRun(survivor.runId);
    assert.equal(stopped.ok, false);
    assert.equal(stopped.orphaned, true);
    assert.equal(stopped.pid, entry.pid);

    try {
      process.kill(entry.pid);
    } catch {
      /* already gone */
    }
  });
});
