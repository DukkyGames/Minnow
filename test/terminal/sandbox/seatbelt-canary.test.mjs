/**
 * Darwin-gated Seatbelt canaries (MIN-553 Phase 1).
 * Non-darwin hosts skip cleanly with an explicit reason (never silent).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../../server/config/home.js';
import {
  createRun,
  getRun,
  killProcessTree,
  stopActiveRun,
  waitForRun,
} from '../../../server/terminal-runner.js';
import {
  buildWorkspacePolicy,
  probeSandbox,
  resetSandboxProbeCache,
  wrapSandbox,
  SANDBOX_EXEC_PATH,
} from '../../../server/terminal/sandbox/index.js';
import { resolveOneShotSpawn } from '../../../server/terminal/one-shot-spawn.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../../config/test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const isDarwin = process.platform === 'darwin';

describe('sandbox seatbelt canaries', { concurrency: false }, () => {
  /** @type {string | undefined} */
  let homeDir;
  /** @type {string | undefined} */
  let prevSandboxFlag;

  before(async () => {
    if (!isDarwin) return;
    prevSandboxFlag = process.env.MINNOW_SHELL_SANDBOX;
    process.env.MINNOW_SHELL_SANDBOX = '1';
    homeDir = setTestHome(process.env, 'minnow-sandbox-canary');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);
    // Plant a fake master-key file under the test home (the real deny target shape).
    await fs.writeFile(path.join(homeDir, '.key'), 'SECRET_KEY_MATERIAL\n', 'utf8');
    resetSandboxProbeCache();
  });

  after(async () => {
    if (!isDarwin) return;
    if (prevSandboxFlag === undefined) delete process.env.MINNOW_SHELL_SANDBOX;
    else process.env.MINNOW_SHELL_SANDBOX = prevSandboxFlag;
    if (homeDir) await rmTestHome(homeDir);
    homeDir = undefined;
    resetMinnowHomeCache();
    resetSandboxProbeCache();
  });

  it('skips cleanly on non-darwin (Seatbelt is macOS-only in Phase 1)', () => {
    if (isDarwin) return;
    // Explicit skip signal — do not silently no-op the whole file without a test.
    assert.notEqual(process.platform, 'darwin');
  });

  it('probe succeeds when sandbox-exec is present', async () => {
    if (!isDarwin) return;
    const probe = await probeSandbox('darwin');
    assert.equal(probe.ok, true);
    await fs.access(SANDBOX_EXEC_PATH);
  });

  it('canary: reading ~/.minnow/.key fails under Seatbelt', async () => {
    if (!isDarwin) return;

    const keyPath = path.join(homeDir, '.key');
    const resolved = resolveOneShotSpawn({
      command: `cat '${keyPath}'`,
      args: [],
      platform: 'darwin',
    });
    const policy = buildWorkspacePolicy({
      workspaceRoot: repoRoot,
      cwd: repoRoot,
      minnowHome: homeDir,
      home: os.homedir(),
      platform: 'darwin',
    });
    const sandboxed = wrapSandbox(resolved, policy, { platform: 'darwin' });

    assert.equal(sandboxed.sandbox.applied, true);
    const result = spawnSync(sandboxed.command, sandboxed.args, {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 10_000,
    });
    // Seatbelt denial → non-zero exit and no secret in stdout
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout || '', /SECRET_KEY_MATERIAL/);
  });

  it('canary: workspace write succeeds under Seatbelt', async () => {
    if (!isDarwin) return;

    const marker = path.join(repoRoot, `.sandbox-canary-${process.pid}.txt`);
    try {
      const resolved = resolveOneShotSpawn({
        command: `echo ok > '${marker}' && cat '${marker}'`,
        args: [],
        platform: 'darwin',
      });
      const policy = buildWorkspacePolicy({
        workspaceRoot: repoRoot,
        cwd: repoRoot,
        minnowHome: homeDir,
        home: os.homedir(),
        platform: 'darwin',
      });
      const sandboxed = wrapSandbox(resolved, policy, { platform: 'darwin' });
      const result = spawnSync(sandboxed.command, sandboxed.args, {
        encoding: 'utf8',
        cwd: repoRoot,
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout || '', /ok/);
      const body = await fs.readFile(marker, 'utf8');
      assert.match(body, /ok/);
    } finally {
      await fs.rm(marker, { force: true });
    }
  });

  it('canary: cancel sandboxed sleep leaves no orphan children', async () => {
    if (!isDarwin) return;

    const { runId } = await createRun({
      command: 'sleep 120',
      cwd: repoRoot,
      source: 'agent',
      sandbox: true,
      timeoutMs: 120_000,
    });

    // Wait until the child is registered
    let childPid = null;
    for (let i = 0; i < 50; i++) {
      const run = getRun(runId);
      childPid = run?.child?.pid ?? null;
      if (childPid) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(childPid, 'expected sandboxed child pid');

    const stopped = await stopActiveRun(runId);
    assert.equal(stopped.ok, true);

    await Promise.race([
      waitForRun(runId),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('waitForRun timed out after cancel')), 5_000),
      ),
    ]).catch(() => {
      /* completion may reject if already torn down — fine if pid is dead */
    });

    const finished = getRun(runId);
    assert.ok(finished?.finished || finished?.stoppedByUser);

    // Parent (sandbox-exec) should be gone; best-effort check via kill -0
    await new Promise((r) => setTimeout(r, 200));
    let alive = false;
    try {
      process.kill(childPid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    assert.equal(alive, false, `orphan pid ${childPid} still alive after cancel`);

    // Extra belt-and-suspenders cleanup if the assertion somehow left a live child
    if (alive && finished?.child) killProcessTree(finished.child);
  });
});
