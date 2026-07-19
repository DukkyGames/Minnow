import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  normalizePanelCwdAfterWorktreeListChange,
  resolveKnownWorktreePath,
} from '../../src/ui/panel-worktree-cwd.ts';

const WS = 'C:/repo';
const WT_A = 'C:/repo/.worktrees/feature-a';

describe('panel worktree cwd helpers', () => {
  test('resolveKnownWorktreePath prefers an exact match', () => {
    const worktrees = [
      { path: WS, branch: 'main' },
      { path: WT_A, branch: 'feature-a' },
    ];
    assert.equal(resolveKnownWorktreePath(worktrees, WT_A, WS), WT_A);
  });

  test('resolveKnownWorktreePath falls back to the workspace root', () => {
    const worktrees = [
      { path: WS, branch: 'main' },
      { path: WT_A, branch: 'feature-a' },
    ];
    assert.equal(
      resolveKnownWorktreePath(worktrees, 'C:/repo/.worktrees/removed', WS),
      WS,
    );
  });

  test('normalizePanelCwdAfterWorktreeListChange clears a removed worktree', () => {
    const worktrees = [{ path: WS, branch: 'main' }];
    assert.equal(
      normalizePanelCwdAfterWorktreeListChange(WT_A, worktrees, WS),
      undefined,
    );
  });

  test('normalizePanelCwdAfterWorktreeListChange keeps a still-present worktree', () => {
    const worktrees = [
      { path: WS, branch: 'main' },
      { path: WT_A, branch: 'feature-a' },
    ];
    assert.equal(
      normalizePanelCwdAfterWorktreeListChange(WT_A, worktrees, WS),
      WT_A,
    );
  });
});
