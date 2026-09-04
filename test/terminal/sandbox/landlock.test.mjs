/**
 * Landlock path-list / argv unit tests (MIN-553). Run on every platform.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildLandlockArgv,
  buildLandlockPathLists,
  buildScopedWriteRootGrants,
  LANDLOCK_HELPER_MAX_PATHS,
  LANDLOCK_MAX_SCOPED_WRITE_GRANTS,
  landlockDeviceWriteAllowlist,
} from '../../../server/terminal/sandbox/landlock.js';
import { buildWorkspacePolicy } from '../../../server/terminal/sandbox/index.js';

const FAKE_HOME = '/home/dev';
const FAKE_MINNOW = '/home/dev/.minnow';
const FAKE_WORKSPACE = '/home/dev/Projects/app';

describe('landlock device write allowlist', () => {
  it('matches Seatbelt device literals (null, zero, tty)', () => {
    assert.deepEqual(landlockDeviceWriteAllowlist(), [
      '/dev/null',
      '/dev/zero',
      '/dev/tty',
    ]);
  });

  it('includes device paths in writePaths from buildLandlockPathLists', () => {
    const policy = buildWorkspacePolicy({
      home: FAKE_HOME,
      minnowHome: FAKE_MINNOW,
      workspaceRoot: FAKE_WORKSPACE,
      cwd: FAKE_WORKSPACE,
      platform: 'linux',
    });
    const { writePaths } = buildLandlockPathLists(policy);
    for (const dev of landlockDeviceWriteAllowlist()) {
      assert.ok(writePaths.includes(dev), `missing write allow: ${dev}`);
    }
    assert.ok(writePaths.includes(path.resolve(FAKE_WORKSPACE)));
  });

  it('emits --write for each device node in buildLandlockArgv', () => {
    const policy = buildWorkspacePolicy({
      home: FAKE_HOME,
      minnowHome: FAKE_MINNOW,
      workspaceRoot: FAKE_WORKSPACE,
      cwd: FAKE_WORKSPACE,
      platform: 'linux',
    });
    const argv = buildLandlockArgv(
      { command: '/bin/sh', args: ['-c', 'true'] },
      policy,
      { seccomp: false },
    );
    for (const dev of landlockDeviceWriteAllowlist()) {
      assert.ok(argv.includes(dev), `argv missing --write ${dev}`);
    }
    const sep = argv.indexOf('--');
    assert.ok(sep > 0);
    assert.equal(argv[sep + 1], '/bin/sh');
  });

  it('caps scoped tmp grants and argv so the helper never exceeds MAX_PATHS', async () => {
    const fakeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-landlock-tmp-'));
    const minnowHome = path.join(fakeTmp, '.minnow');
    await fs.mkdir(minnowHome, { recursive: true });
    try {
      for (let i = 0; i < LANDLOCK_MAX_SCOPED_WRITE_GRANTS + 20; i += 1) {
        await fs.mkdir(path.join(fakeTmp, `sib-${i}`));
      }
      const policy = buildWorkspacePolicy({
        home: FAKE_HOME,
        minnowHome,
        workspaceRoot: FAKE_WORKSPACE,
        cwd: FAKE_WORKSPACE,
        platform: 'linux',
      });
      const grants = buildScopedWriteRootGrants(fakeTmp, {
        ...policy,
        denyReadRoots: [minnowHome],
        writeRoots: [fakeTmp, FAKE_WORKSPACE],
      });
      assert.ok(grants.length <= LANDLOCK_MAX_SCOPED_WRITE_GRANTS);
      assert.ok(!grants.includes(minnowHome));

      const argv = buildLandlockArgv(
        { command: '/bin/sh', args: ['-c', 'true'] },
        {
          ...policy,
          minnowHome,
          denyReadRoots: [minnowHome],
          writeRoots: [fakeTmp, path.resolve(FAKE_WORKSPACE)],
        },
        { seccomp: false },
      );
      let reads = 0;
      let writes = 0;
      for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--read') reads += 1;
        if (argv[i] === '--write') writes += 1;
      }
      assert.ok(reads <= LANDLOCK_HELPER_MAX_PATHS, `too many --read: ${reads}`);
      assert.ok(writes <= LANDLOCK_HELPER_MAX_PATHS, `too many --write: ${writes}`);
      assert.ok(argv.includes('--'));
    } finally {
      await fs.rm(fakeTmp, { recursive: true, force: true });
    }
  });

  it('does not grant blanket read on /tmp when MINNOW_HOME lives under tmp', () => {
    const minnowUnderTmp = '/tmp/minnow-sandbox-canary-12345';
    const policy = buildWorkspacePolicy({
      home: FAKE_HOME,
      minnowHome: minnowUnderTmp,
      workspaceRoot: FAKE_WORKSPACE,
      cwd: FAKE_WORKSPACE,
      platform: 'linux',
    });
    const { readPaths, writePaths } = buildLandlockPathLists(policy);
    assert.ok(!readPaths.includes('/tmp'), 'expected no blanket /tmp read allow');
    assert.ok(!writePaths.includes('/tmp'), 'expected no blanket /tmp write allow');
    assert.ok(
      readPaths.includes(minnowUnderTmp) === false,
      'denied minnow home must not appear in read allows',
    );
    assert.ok(
      writePaths.includes(minnowUnderTmp) === false,
      'denied minnow home must not appear in write allows',
    );
    assert.ok(
      readPaths.includes(path.resolve(FAKE_WORKSPACE)),
      'workspace read should remain allowed',
    );
    const tmpGrants = buildScopedWriteRootGrants('/tmp', policy);
    assert.ok(!tmpGrants.includes('/tmp'));
    assert.ok(!tmpGrants.some((p) => p === minnowUnderTmp || p.startsWith(`${minnowUnderTmp}/`)));
  });
});
