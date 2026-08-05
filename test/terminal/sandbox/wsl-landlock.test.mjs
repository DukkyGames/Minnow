/**
 * MIN-553 Phase 6 — Windows via WSL2 + Landlock (pure unit tests).
 *
 * Never claims bare WSL is sandboxed. Skips/mocks live WSL; does not require
 * Landlock ABI on the host.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildWorkspacePolicy } from '../../../server/terminal/sandbox/policy.js';
import {
  SANDBOX_UNAVAILABLE_REASON,
  wrapSandbox,
  resetSandboxProbeCache,
} from '../../../server/terminal/sandbox/index.js';
import {
  composeWslLandlockWrap,
  ensureWslOneShotSpawn,
  extractWslInnerSpawn,
  hostHelperPathToWsl,
  isWslExeSpawn,
  isWslLandlockWrapped,
  mapPolicyPathToWsl,
  probeWslLandlock,
  probeWslPresent,
  recoverCommandFromWinSpawn,
  resetWslLandlockProbeCache,
  resolveWslLandlockHelper,
  splitWslArgv,
} from '../../../server/terminal/sandbox/wsl-landlock.js';
import { resolveOneShotSpawn } from '../../../server/terminal/one-shot-spawn.js';
import { LANDLOCK_EXIT_ABI_UNAVAILABLE } from '../../../server/terminal/sandbox/landlock.js';
import { buildWslOneShotSpawn } from '../../../server/terminal/wsl.js';

const FAKE_HOME = 'C:\\Users\\minnow-test';
const FAKE_MINNOW = 'C:\\Users\\minnow-test\\.minnow';
const FAKE_WORKSPACE = 'C:\\Users\\minnow-test\\project';
const FAKE_HELPER_WIN = 'C:\\Users\\minnow-test\\native\\minnow-sandbox\\minnow-sandbox';
const FAKE_HELPER_WSL = '/mnt/c/Users/minnow-test/native/minnow-sandbox/minnow-sandbox';

const WSL_FIXTURES = {
  listOutput: 'Ubuntu\r\n',
  defaultOutput: `  NAME                   STATE           VERSION
* Ubuntu                 Running         2
`,
};

afterEach(() => {
  resetWslLandlockProbeCache();
  resetSandboxProbeCache();
});

describe('hostHelperPathToWsl / mapPolicyPathToWsl', () => {
  it('translates Windows helper paths to /mnt mounts', () => {
    assert.equal(hostHelperPathToWsl(FAKE_HELPER_WIN), FAKE_HELPER_WSL);
    assert.equal(mapPolicyPathToWsl(FAKE_WORKSPACE), '/mnt/c/Users/minnow-test/project');
  });

  it('passes through bare helper names and POSIX paths', () => {
    assert.equal(hostHelperPathToWsl('minnow-sandbox'), 'minnow-sandbox');
    assert.equal(hostHelperPathToWsl('/usr/local/bin/minnow-sandbox'), '/usr/local/bin/minnow-sandbox');
  });
});

describe('probeWslPresent', () => {
  it('reports wsl_unavailable without distros', () => {
    const probe = probeWslPresent({
      wslFixtures: { listOutput: '' },
      forceWin32: true,
    });
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE);
  });

  it('succeeds when fixtures list a distro', () => {
    const probe = probeWslPresent({
      wslFixtures: WSL_FIXTURES,
      forceWin32: true,
    });
    assert.equal(probe.ok, true);
    assert.deepEqual(probe.distros, ['Ubuntu']);
    assert.equal(probe.defaultDistro, 'Ubuntu');
  });
});

describe('probeWslLandlock', () => {
  it('maps missing WSL before touching the helper', () => {
    const probe = probeWslLandlock(process.env, {
      wslFixtures: { listOutput: '' },
      forceWin32: true,
      useCache: false,
      spawnSyncFn() {
        assert.fail('must not spawn when WSL is missing');
      },
    });
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE);
  });

  it('maps helper missing when spawn reports not found', () => {
    const probe = probeWslLandlock(process.env, {
      wslFixtures: WSL_FIXTURES,
      forceWin32: true,
      useCache: false,
      helperPath: 'minnow-sandbox',
      spawnSyncFn(cmd, args) {
        assert.equal(cmd, 'wsl.exe');
        assert.ok(args.includes('minnow-sandbox'));
        assert.ok(args.includes('--probe'));
        return { status: 127, stderr: 'minnow-sandbox: not found', stdout: '', error: null };
      },
    });
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING);
  });

  it('maps Landlock ABI unavailable (exit 75) inside WSL', () => {
    const probe = probeWslLandlock(process.env, {
      wslFixtures: WSL_FIXTURES,
      forceWin32: true,
      useCache: false,
      helperPath: FAKE_HELPER_WSL,
      spawnSyncFn() {
        return {
          status: LANDLOCK_EXIT_ABI_UNAVAILABLE,
          stderr: 'landlock ABI unavailable',
          stdout: '',
          error: null,
        };
      },
    });
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE);
  });

  it('succeeds when WSL probe returns landlock_abi', () => {
    const probe = probeWslLandlock(process.env, {
      wslFixtures: WSL_FIXTURES,
      forceWin32: true,
      useCache: false,
      helperPath: FAKE_HELPER_WSL,
      spawnSyncFn() {
        return { status: 0, stderr: '', stdout: 'landlock_abi=4\n', error: null };
      },
    });
    assert.equal(probe.ok, true);
    assert.equal(probe.helperPath, FAKE_HELPER_WSL);
    assert.equal(probe.abi, 4);
  });
});

describe('WSL argv split / ensure / recover', () => {
  it('splits prefix and inner at --', () => {
    const spawn = buildWslOneShotSpawn({
      command: 'echo hi',
      distro: 'Ubuntu',
      cwd: 'C:\\repo',
    });
    const split = splitWslArgv(spawn.args);
    assert.ok(split);
    assert.deepEqual(split.prefix, ['-d', 'Ubuntu', '--cd', '/mnt/c/repo']);
    assert.deepEqual(split.innerArgv, ['bash', '-l', '-c', 'echo hi']);
  });

  it('recovers cmd.exe /c one-shots and routes through WSL', () => {
    const resolved = resolveOneShotSpawn({
      command: 'npm test',
      args: [],
      platform: 'win32',
    });
    assert.equal(resolved.command, 'cmd.exe');
    const recovered = recoverCommandFromWinSpawn(resolved);
    assert.equal(recovered.command, 'npm test');
    assert.deepEqual(recovered.args, []);

    const wsl = ensureWslOneShotSpawn(resolved, {
      distro: 'Ubuntu',
      cwd: FAKE_WORKSPACE,
    });
    assert.equal(isWslExeSpawn(wsl), true);
    const inner = extractWslInnerSpawn(wsl);
    assert.deepEqual(inner, { command: 'bash', args: ['-l', '-c', 'npm test'] });
  });
});

describe('composeWslLandlockWrap', () => {
  const policy = buildWorkspacePolicy({
    home: FAKE_HOME,
    minnowHome: FAKE_MINNOW,
    workspaceRoot: FAKE_WORKSPACE,
    platform: 'win32',
  });

  const wslOpts = {
    wslFixtures: WSL_FIXTURES,
    forceWin32: true,
    skipLiveProbe: true,
    hostHelperPath: FAKE_HELPER_WIN,
  };

  it('composes wsl.exe → minnow-sandbox → inner command (not bare WSL)', () => {
    const resolved = resolveOneShotSpawn({
      command: 'npm test',
      args: [],
      platform: 'win32',
    });
    const composed = composeWslLandlockWrap(resolved, policy, wslOpts);
    assert.equal(composed.ok, true);
    assert.equal(composed.spawn.command, 'wsl.exe');
    assert.equal(isWslLandlockWrapped(composed.spawn), true);

    const inner = extractWslInnerSpawn(composed.spawn);
    assert.ok(inner);
    assert.equal(inner.command, FAKE_HELPER_WSL);
    assert.ok(inner.args.includes('--write'));
    assert.ok(inner.args.includes('/mnt/c/Users/minnow-test/project'));
    assert.ok(inner.args.includes('/tmp'));
    const dd = inner.args.indexOf('--');
    assert.ok(dd >= 0);
    assert.deepEqual(inner.args.slice(dd + 1), ['bash', '-l', '-c', 'npm test']);
  });

  it('wraps an already-WSL spawn by inserting Landlock on the Linux side', () => {
    const existing = buildWslOneShotSpawn({
      command: 'echo hi',
      distro: 'Ubuntu',
      cwd: FAKE_WORKSPACE,
    });
    const composed = composeWslLandlockWrap(existing, policy, wslOpts);
    assert.equal(composed.ok, true);
    assert.equal(isWslLandlockWrapped(composed.spawn), true);
    assert.ok(composed.spawn.args.includes('-d'));
    assert.ok(composed.spawn.args.includes('Ubuntu'));
    const inner = extractWslInnerSpawn(composed.spawn);
    assert.equal(inner.command, FAKE_HELPER_WSL);
  });

  it('returns helper_missing without rewriting when helper absent', () => {
    const resolved = resolveOneShotSpawn({
      command: 'echo hi',
      args: [],
      platform: 'win32',
    });
    const composed = composeWslLandlockWrap(resolved, policy, {
      wslFixtures: WSL_FIXTURES,
      forceWin32: true,
      skipLiveProbe: true,
      hostHelperPath: '',
    });
    assert.equal(composed.ok, false);
    assert.equal(composed.reason, SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING);
  });

  it('returns wsl_unavailable without rewriting to bare wsl.exe', () => {
    const resolved = resolveOneShotSpawn({
      command: 'echo hi',
      args: [],
      platform: 'win32',
    });
    const composed = composeWslLandlockWrap(resolved, policy, {
      wslFixtures: { listOutput: '' },
      forceWin32: true,
      skipLiveProbe: true,
      hostHelperPath: FAKE_HELPER_WIN,
    });
    assert.equal(composed.ok, false);
    assert.equal(composed.reason, SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE);
  });
});

describe('wrapSandbox win32 composition', () => {
  it('applies wsl-landlock when fixtures + helper are provided', () => {
    const policy = buildWorkspacePolicy({
      home: FAKE_HOME,
      minnowHome: FAKE_MINNOW,
      workspaceRoot: FAKE_WORKSPACE,
      platform: 'win32',
    });
    const resolved = resolveOneShotSpawn({
      command: 'dir',
      args: [],
      platform: 'win32',
    });
    const wrapped = wrapSandbox(resolved, policy, {
      platform: 'win32',
      wsl: {
        wslFixtures: WSL_FIXTURES,
        forceWin32: true,
        skipLiveProbe: true,
        hostHelperPath: FAKE_HELPER_WIN,
      },
    });
    assert.equal(wrapped.sandbox.applied, true);
    assert.equal(wrapped.sandbox.kind, 'wsl-landlock');
    assert.equal(wrapped.command, 'wsl.exe');
    assert.equal(isWslLandlockWrapped(wrapped), true);
  });

  it('never reports applied for bare WSL without Landlock helper in argv', () => {
    const bare = buildWslOneShotSpawn({ command: 'cat /mnt/c/Users/x/.minnow/.key' });
    // Sanity: bare WSL is not a landlock wrap
    assert.equal(isWslLandlockWrapped(bare), false);
    assert.equal(isWslExeSpawn(bare), true);
    const inner = extractWslInnerSpawn(bare);
    assert.ok(inner);
    assert.notEqual(path.basename(inner.command), 'minnow-sandbox');
  });
});

describe('resolveWslLandlockHelper', () => {
  it('translates MINNOW_SANDBOX_HELPER Windows paths', () => {
    // Use this test file as an existsSync stand-in for a host-visible helper.
    const selfPath = fileURLToPath(import.meta.url);
    const env = { MINNOW_SANDBOX_HELPER: selfPath };
    const resolved = resolveWslLandlockHelper(env, { allowBareName: false });
    assert.equal(resolved, hostHelperPathToWsl(selfPath));
  });

  it('accepts bare name override for WSL PATH', () => {
    const env = { MINNOW_SANDBOX_HELPER: 'minnow-sandbox' };
    assert.equal(resolveWslLandlockHelper(env), 'minnow-sandbox');
  });
});
