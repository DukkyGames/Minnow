/**
 * Post-merge dependency refresh (manifest/lockfile triggered installs).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { refreshDependencies } from '../../server/worktree/dep-install.js';

describe('dep-install', () => {
  let tmpDir;

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('refreshDependencies runs node install when a manifest/lockfile changed', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-dep-install-'));
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'dep-install-test', version: '1.0.0', dependencies: {} }),
      'utf8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify({
        name: 'dep-install-test',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'dep-install-test', version: '1.0.0' } },
      }),
      'utf8',
    );

    const result = await refreshDependencies(tmpDir, ['package-lock.json'], { timeout: 120_000 });
    assert.ok(Array.isArray(result.ran));
    assert.ok(Array.isArray(result.failed));
    const attempted = [...result.ran, ...result.failed];
    assert.ok(attempted.some((cmd) => /^npm install/.test(cmd)), `expected npm install attempt, got ${attempted}`);
  });

  test('refreshDependencies skips install when only unrelated files changed', async () => {
    const result = await refreshDependencies(tmpDir, ['README.md'], { timeout: 5_000 });
    assert.deepEqual(result.ran, []);
    assert.deepEqual(result.failed, []);
  });

  test('refreshDependencies never throws when install tooling is unavailable', async () => {
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-dep-install-missing-'));
    await fs.writeFile(path.join(isolated, 'go.mod'), 'module example.com/test\n\ngo 1.22\n', 'utf8');
    await fs.writeFile(path.join(isolated, 'go.sum'), '', 'utf8');

    const result = await refreshDependencies(isolated, ['go.sum'], { timeout: 5_000 });
    assert.ok(Array.isArray(result.ran));
    assert.ok(Array.isArray(result.failed));

    await fs.rm(isolated, { recursive: true, force: true });
  });
});
