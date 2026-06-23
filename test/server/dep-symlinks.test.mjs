/**
 * Dependency dir symlinks into board worktrees.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { symlinkDependencyDirs, materializeDepDirs } from '../../server/worktree/dep-symlinks.js';
import { createWorktree, ensureIntegration } from '../../server/worktree/worktree-ops.js';
import { getWorktreeSlotPath } from '../../server/worktree/paths.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';

const execFileAsync = promisify(execFile);
const BOARD_ID = 'dep-symlink-board-22222222';

describe('dep-symlinks', () => {
  let repoDir;
  let minnowHome;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-dep-symlink-'));
    repoDir = path.join(root, 'repo');
    minnowHome = path.join(root, 'minnow-home');
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(minnowHome, { recursive: true });
    process.env.MINNOW_HOME = minnowHome;
    await setWorkspaceRoot(repoDir);

    await execFileAsync('git', ['init'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await fs.writeFile(path.join(repoDir, 'package.json'), '{"name":"dep-symlink-test"}\n', 'utf8');
    await fs.mkdir(path.join(repoDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'node_modules', 'pkg.txt'), 'installed\n', 'utf8');
    await execFileAsync('git', ['add', 'package.json'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir, windowsHide: true });
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
  });

  test('symlinkDependencyDirs links node_modules when package.json exists', async () => {
    const wtDir = path.join(path.dirname(repoDir), 'manual-wt');
    await fs.mkdir(wtDir, { recursive: true });

    await symlinkDependencyDirs(repoDir, wtDir);

    const linkPath = path.join(wtDir, 'node_modules');
    const st = await fs.lstat(linkPath);
    assert.ok(st.isSymbolicLink() || st.isDirectory());

    const resolved = await fs.realpath(linkPath);
    const sourceResolved = await fs.realpath(path.join(repoDir, 'node_modules'));
    assert.equal(resolved, sourceResolved);

    const content = await fs.readFile(path.join(linkPath, 'pkg.txt'), 'utf8');
    assert.equal(content, 'installed\n');

    await fs.rm(wtDir, { recursive: true, force: true });
  });

  test('createWorktree links node_modules from integration worktree (seed resolves to main)', async () => {
    const integrationBranch = `minnow/board/${BOARD_ID}/integration`;
    const taskBranch = `minnow/board/${BOARD_ID}/task/W1-A`;

    const ensured = await ensureIntegration({
      boardId: BOARD_ID,
      branch: integrationBranch,
    });
    assert.equal(ensured.ok, true);

    const intPath = getWorktreeSlotPath(BOARD_ID, 'integration');
    const intNm = path.join(intPath, 'node_modules');
    assert.ok(await fs.stat(intNm).then((s) => s.isDirectory() || s.isSymbolicLink()));

    const created = await createWorktree({
      boardId: BOARD_ID,
      slotId: 'task-W1-A',
      branch: taskBranch,
      baseRef: integrationBranch,
    });
    assert.equal(created.ok, true);

    const wtPath = getWorktreeSlotPath(BOARD_ID, 'task-W1-A');
    const wtNm = path.join(wtPath, 'node_modules');
    const resolved = await fs.realpath(wtNm);
    // Integration seeds node_modules from main; realpath collapse still lands on main.
    const sourceResolved = await fs.realpath(path.join(repoDir, 'node_modules'));
    assert.equal(resolved, sourceResolved);
  });

  test('createWorktree sees integration-layer installs in node_modules', async () => {
    const boardId = 'dep-symlink-board-33333333';
    const integrationBranch = `minnow/board/${boardId}/integration`;
    const taskBranch = `minnow/board/${boardId}/task/W2-A`;

    assert.equal(
      (await ensureIntegration({ boardId, branch: integrationBranch })).ok,
      true,
    );

    const intPath = getWorktreeSlotPath(boardId, 'integration');
    const intNm = path.join(intPath, 'node_modules');
    await fs.rm(intNm);
    await fs.mkdir(intNm, { recursive: true });
    await fs.writeFile(path.join(intNm, 'integration-marker.txt'), 'from-integration\n', 'utf8');

    const created = await createWorktree({
      boardId,
      slotId: 'task-W2-A',
      branch: taskBranch,
      baseRef: integrationBranch,
    });
    assert.equal(created.ok, true);

    const wtPath = getWorktreeSlotPath(boardId, 'task-W2-A');
    const wtNm = path.join(wtPath, 'node_modules');
    const resolved = await fs.realpath(wtNm);
    const intResolved = await fs.realpath(intNm);
    assert.equal(resolved, intResolved);

    const marker = await fs.readFile(path.join(wtNm, 'integration-marker.txt'), 'utf8');
    assert.equal(marker, 'from-integration\n');
  });

  test('materializeDepDirs converts seed junction to absent dir without deleting main target', async () => {
    const boardId = 'dep-symlink-board-44444444';
    const integrationBranch = `minnow/board/${boardId}/integration`;

    assert.equal(
      (await ensureIntegration({ boardId, branch: integrationBranch })).ok,
      true,
    );

    const intPath = getWorktreeSlotPath(boardId, 'integration');
    const intNm = path.join(intPath, 'node_modules');
    const mainNm = path.join(repoDir, 'node_modules');

    const beforeInt = await fs.lstat(intNm);
    assert.ok(beforeInt.isSymbolicLink() || beforeInt.isDirectory());

    await materializeDepDirs(intPath, ['node_modules']);

    await assert.rejects(() => fs.lstat(intNm));

    const mainContent = await fs.readFile(path.join(mainNm, 'pkg.txt'), 'utf8');
    assert.equal(mainContent, 'installed\n');
  });
});
