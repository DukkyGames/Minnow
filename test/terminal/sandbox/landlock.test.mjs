/**
 * Landlock path-list / argv unit tests (MIN-553). Run on every platform.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildLandlockArgv,
  buildLandlockPathLists,
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
});
