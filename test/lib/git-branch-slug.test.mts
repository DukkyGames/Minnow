/**
 * MIN-659: git branch / worktree name slugs.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  GIT_REF_FALLBACK_BRANCH,
  GIT_REF_FALLBACK_WORKTREE,
  gitRefFolderName,
  pathBasename,
  slugifyGitRefName,
  suggestGitRefName,
} from '../../src/lib/git-branch-slug.mjs';

describe('slugifyGitRefName', () => {
  test('turns Test Worktree into a valid kebab slug', () => {
    assert.equal(slugifyGitRefName('Test Worktree'), 'test-worktree');
  });

  test('preserves slash hierarchy while slugging each segment', () => {
    assert.equal(slugifyGitRefName('feature/My Branch'), 'feature/my-branch');
    assert.equal(slugifyGitRefName('feature//Foo'), 'feature/foo');
  });

  test('strips illegal git-ref characters instead of rejecting', () => {
    assert.equal(slugifyGitRefName('fix: login *bug*?'), 'fix-login-bug');
    assert.equal(slugifyGitRefName('Café Feature'), 'cafe-feature');
    assert.equal(slugifyGitRefName('...dots...'), 'dots');
    assert.equal(slugifyGitRefName('-leading'), 'leading');
  });

  test('falls back when the source is empty or only illegal characters', () => {
    assert.equal(slugifyGitRefName(''), GIT_REF_FALLBACK_BRANCH);
    assert.equal(slugifyGitRefName('***'), GIT_REF_FALLBACK_BRANCH);
    assert.equal(slugifyGitRefName('HEAD'), GIT_REF_FALLBACK_BRANCH);
    assert.equal(slugifyGitRefName('!!!', GIT_REF_FALLBACK_WORKTREE), 'worktree');
  });

  test('is idempotent for an already-valid slug', () => {
    assert.equal(slugifyGitRefName('test-worktree'), 'test-worktree');
    assert.equal(slugifyGitRefName('feature/my-branch'), 'feature/my-branch');
  });
});

describe('gitRefFolderName', () => {
  test('flattens slashes so worktree folders stay a single segment', () => {
    assert.equal(gitRefFolderName('feature/my-branch'), 'feature-my-branch');
    assert.equal(gitRefFolderName('Test Worktree'), 'test-worktree');
  });
});

describe('suggestGitRefName', () => {
  test('prefers a readable title slug over a path', () => {
    assert.equal(
      suggestGitRefName({
        title: 'Fix login bug',
        path: '/Users/dev/opaque-id-repo',
      }),
      'fix-login-bug',
    );
  });

  test('uses the path basename when the title is empty', () => {
    assert.equal(
      suggestGitRefName({
        title: '   ',
        path: 'C:\\Users\\dev\\Minnow',
        fallback: 'worktree',
      }),
      'minnow',
    );
  });

  test('avoids reserved names such as the current branch', () => {
    assert.equal(
      suggestGitRefName({
        title: 'Minnow',
        reserved: ['minnow', 'main', 'master'],
      }),
      'minnow-2',
    );
  });

  test('does not emit an opaque id when sources are missing', () => {
    assert.equal(suggestGitRefName({ fallback: 'worktree' }), 'worktree');
  });
});

describe('pathBasename', () => {
  test('handles POSIX and Windows separators', () => {
    assert.equal(pathBasename('/repo/src/app'), 'app');
    assert.equal(pathBasename('C:\\repo\\Minnow\\'), 'Minnow');
  });
});
