/**
 * Registered git worktree allowlist (server).
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import {
  isAllowedWorkspaceRoot,
  isAllowedWorkspaceRootAsync,
  validateAllowedWorkspaceRoot,
} from '../../server/chats-workspace/paths.js';
import {
  invalidateRegisteredWorktreeCache,
  isRegisteredGitWorktreePath,
  isRepoLocalWorktreePath,
} from '../../server/worktree/allowlist.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';

const execFileAsync = promisify(execFile);

describe('worktree allowlist', { concurrency: false }, () => {
  let repoDir;
  let siblingWt;
  let localWt;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-wt-allow-'));
    repoDir = path.join(root, 'repo');
    siblingWt = path.join(root, 'sibling-wt');
    localWt = path.join(repoDir, '.worktrees', 'feature-a');
    await fs.mkdir(repoDir, { recursive: true });
    await setWorkspaceRoot(repoDir);

    await execFileAsync('git', ['init'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, windowsHide: true });
    await fs.writeFile(path.join(repoDir, 'README.md'), '# base\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir, windowsHide: true });

    await execFileAsync(
      'git',
      ['worktree', 'add', '-b', 'feature/sibling', siblingWt],
      { cwd: repoDir, windowsHide: true },
    );
    invalidateRegisteredWorktreeCache();
  });

  after(async () => {
    invalidateRegisteredWorktreeCache();
  });

  test('isRepoLocalWorktreePath accepts repo-local .worktrees/', () => {
    assert.equal(isRepoLocalWorktreePath(localWt), true);
    assert.equal(isAllowedWorkspaceRoot(localWt), true);
  });

  test('isRegisteredGitWorktreePath accepts sibling git worktree paths', async () => {
    await setWorkspaceRoot(repoDir);
    invalidateRegisteredWorktreeCache();
    assert.equal(await isRegisteredGitWorktreePath(siblingWt), true);
    assert.equal(await isAllowedWorkspaceRootAsync(siblingWt), true);
  });

  test('validateAllowedWorkspaceRoot resolves registered worktree directory', async () => {
    await setWorkspaceRoot(repoDir);
    invalidateRegisteredWorktreeCache();
    const resolved = await validateAllowedWorkspaceRoot(siblingWt);
    assert.equal(path.resolve(resolved), path.resolve(siblingWt));
  });

  test('rejects arbitrary paths outside allowlist', async () => {
    const outside = path.join(path.dirname(repoDir), 'nowhere');
    assert.equal(isAllowedWorkspaceRoot(outside), false);
    assert.equal(await isAllowedWorkspaceRootAsync(outside), false);
  });
});
