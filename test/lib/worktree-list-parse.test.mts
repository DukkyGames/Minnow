import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterUserFacingBranches,
  filterUserFacingWorktrees,
  formatWorktreeOptionLabel,
  isMinnowBoardBranch,
  parseWorktreeListPorcelain,
} from '../../src/lib/worktree-list-parse.ts';
import { repoKeyFromWorkspacePath } from '../../src/lib/repo-key.mjs';

describe('parseWorktreeListPorcelain', () => {
  it('parses multiple worktrees with branches', () => {
    const output = [
      'worktree /repo/main',
      'HEAD abc1111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repo/task-1',
      'HEAD def2222222222222222222222222222222222',
      'branch refs/heads/feature/task-1',
      '',
      'worktree /repo/detached',
      'HEAD abc1111111111111111111111111111111111',
      'detached',
    ].join('\n');

    const parsed = parseWorktreeListPorcelain(output);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0]?.path, '/repo/main');
    assert.equal(parsed[0]?.branch, 'main');
    assert.equal(parsed[0]?.detached, false);
    assert.equal(parsed[1]?.branch, 'feature/task-1');
    assert.equal(parsed[2]?.detached, true);
    assert.equal(parsed[2]?.branch, undefined);
  });
});

describe('filterUserFacingBranches', () => {
  it('drops minnow board branches and worktree-locked names', () => {
    assert.equal(isMinnowBoardBranch('minnow/board/g/task/W1-A'), true);
    const out = filterUserFacingBranches(
      ['main', 'minnow/board/g/integration', 'feature'],
      new Set(['chat-branch']),
    );
    assert.deepEqual(out, ['main', 'feature']);
  });
});

describe('formatWorktreeOptionLabel', () => {
  it('labels main workspace and linked worktrees', () => {
    const main = formatWorktreeOptionLabel(
      { path: '/repo/main', head: 'abc', branch: 'main', detached: false },
      '/repo/main',
    );
    assert.equal(main, 'main — workspace');

    const task = formatWorktreeOptionLabel(
      {
        path: '/home/.minnow/worktrees/board/task-1',
        head: 'def',
        branch: 'minnow/board/x/task/y',
        detached: false,
      },
      '/repo/main',
    );
    assert.match(task, /^minnow\/board\/x\/task\/y — task-1$/);
  });
});

describe('filterUserFacingWorktrees', () => {
  it('keeps the main checkout and this repoKey, drops other repoKeys', () => {
    const workspace = '/repo/minnow';
    const thisKey = repoKeyFromWorkspacePath(workspace);
    const worktrees = [
      { path: '/repo/minnow', head: 'abc', branch: 'main', detached: false },
      {
        path: `/home/.minnow/worktrees/${thisKey}/board-a/task-W1-A`,
        head: 'def',
        branch: 'minnow/board/a/task/W1-A',
        detached: false,
      },
      {
        path: '/home/.minnow/worktrees/other-deadbeef/board-b/task-W1-A',
        head: 'ghi',
        branch: 'minnow/board/b/task/W1-A',
        detached: false,
      },
      {
        path: '/tmp/user-worktree',
        head: 'jkl',
        branch: 'feature',
        detached: false,
      },
    ];
    const kept = filterUserFacingWorktrees(worktrees, workspace).map((wt) => wt.path);
    assert.deepEqual(kept, [
      '/repo/minnow',
      `/home/.minnow/worktrees/${thisKey}/board-a/task-W1-A`,
      '/tmp/user-worktree',
    ]);
  });
});
