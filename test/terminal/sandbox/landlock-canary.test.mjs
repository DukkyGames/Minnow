/**
 * Linux-gated Landlock canaries (MIN-553 Phase 5).
 * Non-linux hosts skip cleanly. On linux: assert deny of ~/.minnow/.key when
 * helper + Landlock ABI are present; otherwise skip/unavailable honestly.
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
  probeLandlock,
  probeSandbox,
  resetSandboxProbeCache,
  resolveMinnowSandboxHelper,
  wrapSandbox,
  SANDBOX_UNAVAILABLE_REASON,
} from '../../../server/terminal/sandbox/index.js';
import { resolveOneShotSpawn } from '../../../server/terminal/one-shot-spawn.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../../config/test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const isLinux = process.platform === 'linux';

describe('sandbox landlock canaries', { concurrency: false }, () => {
  /** @type {string | undefined} */
  let homeDir;
  /** @type {string | undefined} */
  let prevSandboxFlag;
  /** @type {boolean} */
  let landlockReady = false;

  before(async () => {
    if (!isLinux) return;
    prevSandboxFlag = process.env.MINNOW_SHELL_SANDBOX;
    process.env.MINNOW_SHELL_SANDBOX = '1';
    homeDir = setTestHome(process.env, 'minnow-sandbox-landlock-canary');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);
    await fs.writeFile(path.join(homeDir, '.key'), 'SECRET_KEY_MATERIAL\n', 'utf8');
    resetSandboxProbeCache();

    const helper = resolveMinnowSandboxHelper();
    const probe = probeLandlock();
    landlockReady = Boolean(helper && probe.ok);
  });

  after(async () => {
    if (!isLinux) return;
    if (prevSandboxFlag === undefined) delete process.env.MINNOW_SHELL_SANDBOX;
    else process.env.MINNOW_SHELL_SANDBOX = prevSandboxFlag;
    if (homeDir) await rmTestHome(homeDir);
    homeDir = undefined;
    resetMinnowHomeCache();
    resetSandboxProbeCache();
  });

  it('skips cleanly on non-linux (Landlock helper is Linux-only)', () => {
    if (isLinux) return;
    assert.notEqual(process.platform, 'linux');
  });

  it('probe is honest when helper or ABI is missing', async () => {
    if (!isLinux) return;
    const probe = await probeSandbox('linux');
    if (landlockReady) {
      assert.equal(probe.ok, true);
      return;
    }
    assert.equal(probe.ok, false);
    assert.ok(
      [
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE,
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      ].includes(probe.reason),
      `unexpected reason: ${probe.reason}`,
    );
  });

  it('canary: reading ~/.minnow/.key fails under Landlock when helper+ABI present', async () => {
    if (!isLinux) return;
    if (!landlockReady) {
      // Honest skip — CI builds the helper on ubuntu; local Windows/mac never claim pass.
      assert.equal(landlockReady, false);
      return;
    }

    const keyPath = path.join(homeDir, '.key');
    const resolved = resolveOneShotSpawn({
      command: `cat '${keyPath}'`,
      args: [],
      platform: 'linux',
    });
    const policy = buildWorkspacePolicy({
      workspaceRoot: repoRoot,
      cwd: repoRoot,
      minnowHome: homeDir,
      home: os.homedir(),
      platform: 'linux',
    });
    const sandboxed = wrapSandbox(resolved, policy, { platform: 'linux' });

    assert.equal(sandboxed.sandbox.applied, true);
    assert.equal(sandboxed.sandbox.kind, 'landlock');
    const result = spawnSync(sandboxed.command, sandboxed.args, {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout || '', /SECRET_KEY_MATERIAL/);
  });

  it('canary: workspace write succeeds under Landlock when helper+ABI present', async () => {
    if (!isLinux) return;
    if (!landlockReady) {
      assert.equal(landlockReady, false);
      return;
    }

    const marker = path.join(repoRoot, `.sandbox-landlock-canary-${process.pid}.txt`);
    try {
      const resolved = resolveOneShotSpawn({
        command: `echo ok > '${marker}' && cat '${marker}'`,
        args: [],
        platform: 'linux',
      });
      const policy = buildWorkspacePolicy({
        workspaceRoot: repoRoot,
        cwd: repoRoot,
        minnowHome: homeDir,
        home: os.homedir(),
        platform: 'linux',
      });
      const sandboxed = wrapSandbox(resolved, policy, { platform: 'linux' });
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

  it('canary: redirect to /dev/null succeeds under Landlock when helper+ABI present', async () => {
    if (!isLinux) return;
    if (!landlockReady) {
      assert.equal(landlockReady, false);
      return;
    }

    const resolved = resolveOneShotSpawn({
      command: 'echo sandbox-dev-null > /dev/null',
      args: [],
      platform: 'linux',
    });
    const policy = buildWorkspacePolicy({
      workspaceRoot: repoRoot,
      cwd: repoRoot,
      minnowHome: homeDir,
      home: os.homedir(),
      platform: 'linux',
    });
    const sandboxed = wrapSandbox(resolved, policy, { platform: 'linux' });
    const result = spawnSync(sandboxed.command, sandboxed.args, {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
