import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveTrunkBranchName,
  shouldShowMergeToMain,
} from '../../src/lib/git-trunk-branch.ts';
import { mergeToMainButtonVisible } from '../../src/ui/git-merge-to-main.ts';

describe('resolveTrunkBranchName', () => {
  it('prefers main over master', () => {
    assert.equal(resolveTrunkBranchName(['feature', 'main', 'master']), 'main');
  });

  it('falls back to master when main is absent', () => {
    assert.equal(resolveTrunkBranchName(['feature', 'master']), 'master');
  });

  it('defaults to main when neither trunk exists', () => {
    assert.equal(resolveTrunkBranchName(['feature']), 'main');
  });
});

describe('shouldShowMergeToMain', () => {
  it('hides on trunk branch in the main worktree', () => {
    assert.equal(
      shouldShowMergeToMain({
        currentBranch: 'main',
        trunkBranch: 'main',
        onMainWorktree: true,
      }),
      false,
    );
  });

  it('shows on a feature branch in the main worktree', () => {
    assert.equal(
      shouldShowMergeToMain({
        currentBranch: 'feature/foo',
        trunkBranch: 'main',
        onMainWorktree: true,
      }),
      true,
    );
  });

  it('shows on a feature branch in a secondary worktree', () => {
    assert.equal(
      shouldShowMergeToMain({
        currentBranch: 'feature/foo',
        trunkBranch: 'main',
        onMainWorktree: false,
      }),
      true,
    );
  });

  it('hides on trunk branch in a secondary worktree', () => {
    assert.equal(
      shouldShowMergeToMain({
        currentBranch: 'main',
        trunkBranch: 'main',
        onMainWorktree: false,
      }),
      false,
    );
  });
});

describe('mergeToMainButtonVisible', () => {
  it('delegates to trunk resolution and visibility rules', () => {
    assert.equal(
      mergeToMainButtonVisible({
        sourceBranch: 'feature/bar',
        mainWorkspaceCwd: '/repo',
        onMainWorktree: false,
        localBranches: ['main', 'feature/bar'],
      }),
      true,
    );
    assert.equal(
      mergeToMainButtonVisible({
        sourceBranch: 'main',
        mainWorkspaceCwd: '/repo',
        onMainWorktree: true,
        localBranches: ['main'],
      }),
      false,
    );
  });
});
