/**
 * Windows-gated WSL2 + Landlock canaries (MIN-553 Phase 6).
 *
 * Live assertions only when win32 + WSL + Landlock helper/ABI are available.
 * Otherwise skip cleanly (never claim bare WSL is containment).
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
  buildWorkspacePolicy,
  composeWslLandlockWrap,
  isWslLandlockWrapped,
  probeWslLandlock,
  resetSandboxProbeCache,
  resetWslLandlockProbeCache,
  resolveMinnowSandboxHelper,
  SANDBOX_UNAVAILABLE_REASON,
} from '../../../server/terminal/sandbox/index.js';
import { resolveOneShotSpawn } from '../../../server/terminal/one-shot-spawn.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../../server/workspace/root.js';
import { windowsPathToWslPath } from '../../../server/terminal/wsl.js';
import { rmTestHome, setTestHome } from '../../config/test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const isWin32 = process.platform === 'win32';

describe('sandbox wsl-landlock canaries', { concurrency: false }, () => {
  /** @type {string | undefined} */
  let homeDir;
  /** @type {string | undefined} */
  let prevSandboxFlag;
  /** @type {boolean} */
  let wslLandlockReady = false;
  /** @type {string | undefined} */
  let helperPath;

  before(async () => {
    if (!isWin32) return;
    prevSandboxFlag = process.env.MINNOW_SHELL_SANDBOX;
    process.env.MINNOW_SHELL_SANDBOX = '1';
    homeDir = setTestHome(process.env, 'minnow-sandbox-wsl-canary');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);
    // Secret-shaped file under the test Minnow home (deny-read target).
    await fs.writeFile(path.join(homeDir, '.key'), 'SECRET_KEY_MATERIAL\n', 'utf8');
    resetSandboxProbeCache();
    resetWslLandlockProbeCache();

    const hostHelper = resolveMinnowSandboxHelper();
    const probe = probeWslLandlock(process.env, { useCache: false, allowBareName: true });
    helperPath = probe.helperPath;
    wslLandlockReady = Boolean(probe.ok && (hostHelper || helperPath));
  });

  after(async () => {
    if (!isWin32) return;
    if (prevSandboxFlag === undefined) delete process.env.MINNOW_SHELL_SANDBOX;
    else process.env.MINNOW_SHELL_SANDBOX = prevSandboxFlag;
    if (homeDir) await rmTestHome(homeDir);
    homeDir = undefined;
    resetMinnowHomeCache();
    resetSandboxProbeCache();
    resetWslLandlockProbeCache();
  });

  it('skips cleanly on non-Windows (WSL Landlock is win32-only)', () => {
    if (isWin32) return;
    assert.notEqual(process.platform, 'win32');
  });

  it('probe is honest when WSL or Landlock is missing', () => {
    if (!isWin32) return;
    if (wslLandlockReady) {
      assert.equal(wslLandlockReady, true);
      return;
    }
    const probe = probeWslLandlock(process.env, { useCache: false, allowBareName: true });
    assert.equal(probe.ok, false);
    assert.ok(
      [
        SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE,
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      ].includes(probe.reason),
      `unexpected reason: ${probe.reason}`,
    );
  });

  it('canary: sandboxed cat of host ~/.minnow/.key fails when WSL+Landlock ready', async () => {
    if (!isWin32) return;
    if (!wslLandlockReady) {
      assert.equal(wslLandlockReady, false);
      return;
    }

    const keyPath = path.join(homeDir, '.key');
    const keyBody = await fs.readFile(keyPath, 'utf8');
    assert.match(keyBody, /SECRET_KEY_MATERIAL/);

    // Unsandboxed read must succeed — otherwise a missing helper also "passes" the deny test.
    const unsandboxed = spawnSync('wsl.exe', ['--', 'cat', windowsPathToWslPath(keyPath)], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(unsandboxed.status, 0, unsandboxed.stderr || unsandboxed.stdout);
    assert.match(unsandboxed.stdout || '', /SECRET_KEY_MATERIAL/);

    const keyWsl = windowsPathToWslPath(keyPath);
    const resolved = resolveOneShotSpawn({
      command: `cat '${keyWsl}'`,
      args: [],
      platform: 'win32',
    });
    const policy = buildWorkspacePolicy({
      workspaceRoot: repoRoot,
      cwd: repoRoot,
      minnowHome: homeDir,
      home: os.homedir(),
      platform: 'win32',
    });
    const composed = composeWslLandlockWrap(resolved, policy, { cwd: repoRoot });
    assert.equal(composed.ok, true, composed.detail);
    assert.equal(isWslLandlockWrapped(composed.spawn), true);

    const result = spawnSync(composed.spawn.command, composed.spawn.args, {
      encoding: 'utf8',
      cwd: os.homedir(),
      timeout: 30_000,
      windowsHide: true,
    });
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout || '', /SECRET_KEY_MATERIAL/);
  });

  it('canary: workspace write succeeds under WSL+Landlock when ready', async () => {
    if (!isWin32) return;
    if (!wslLandlockReady) {
      assert.equal(wslLandlockReady, false);
      return;
    }

    const marker = path.join(repoRoot, `.sandbox-wsl-canary-${process.pid}.txt`);
    const markerWsl = windowsPathToWslPath(marker);
    try {
      const resolved = resolveOneShotSpawn({
        command: `echo ok > '${markerWsl}' && cat '${markerWsl}'`,
        args: [],
        platform: 'win32',
      });
      const policy = buildWorkspacePolicy({
        workspaceRoot: repoRoot,
        cwd: repoRoot,
        minnowHome: homeDir,
        home: os.homedir(),
        platform: 'win32',
      });
      const composed = composeWslLandlockWrap(resolved, policy, { cwd: repoRoot });
      assert.equal(composed.ok, true, composed.detail);
      const result = spawnSync(composed.spawn.command, composed.spawn.args, {
        encoding: 'utf8',
        cwd: os.homedir(),
        timeout: 30_000,
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout || '', /ok/);
      const body = await fs.readFile(marker, 'utf8');
      assert.match(body, /ok/);
    } finally {
      await fs.rm(marker, { force: true });
    }
  });
});
