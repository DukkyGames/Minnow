import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveTrunkBranchName,
  shouldShowMergeToMain,
  trunkBranchExists,
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

  it('uses locked local master when trunk is checked out in another worktree', () => {
    assert.equal(
      resolveTrunkBranchName(['feature/foo'], [], ['master']),
      'master',
    );
  });

  it('uses remote master when trunk is checked out in another worktree', () => {
    assert.equal(
      resolveTrunkBranchName(['feature/foo'], ['remotes/origin/master']),
      'master',
    );
  });

  it('uses remote main when trunk is checked out in another worktree', () => {
    assert.equal(
      resolveTrunkBranchName(['feature/foo'], ['remotes/origin/main']),
      'main',
    );
  });

  it('follows origin HEAD when only symbolic ref is present', () => {
    assert.equal(
      resolveTrunkBranchName(
        ['feature/foo'],
        ['remotes/origin/HEAD -> origin/master'],
      ),
      'master',
    );
  });
});

describe('trunkBranchExists', () => {
  it('accepts a locked local trunk branch', () => {
    assert.equal(trunkBranchExists('master', ['feature/foo'], [], ['master']), true);
  });

  it('accepts a remote-only trunk branch', () => {
    assert.equal(
      trunkBranchExists('master', ['feature/foo'], ['remotes/origin/master']),
      true,
    );
  });

  it('rejects a default trunk name with no matching branch', () => {
    assert.equal(trunkBranchExists('main', ['feature/foo'], []), false);
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

  it('shows when trunk is only visible on the remote', () => {
    assert.equal(
      mergeToMainButtonVisible({
        sourceBranch: 'feature/bar',
        mainWorkspaceCwd: '/repo',
        onMainWorktree: false,
        localBranches: ['feature/bar'],
        remoteBranches: ['remotes/origin/master'],
      }),
      true,
    );
  });

  it('shows when trunk is checked out in another worktree', () => {
    assert.equal(
      mergeToMainButtonVisible({
        sourceBranch: 'feature/bar',
        mainWorkspaceCwd: '/repo',
        onMainWorktree: false,
        localBranches: ['feature/bar'],
        lockedLocalBranches: ['master'],
      }),
      true,
    );
  });
});
