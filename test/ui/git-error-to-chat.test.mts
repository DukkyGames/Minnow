import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGitErrorFixSeedMessage,
} from '../../src/ui/git-error-to-chat.ts';

describe('buildGitErrorFixSeedMessage', () => {
  it('includes commit failure context and error text', () => {
    const seed = buildGitErrorFixSeedMessage('commit', 'error: pathspec did not match', {
      branch: 'feature/test',
    });
    assert.match(seed, /commit failed in Source Control/i);
    assert.match(seed, /pathspec did not match/);
    assert.match(seed, /feature\/test/);
    assert.match(seed, /git_status/);
  });

  it('includes worktree path when cwd differs from workspace', () => {
    const seed = buildGitErrorFixSeedMessage('merge', 'CONFLICT (content): file.ts', {
      cwd: '/repo/.worktrees/task-a',
      branch: 'main',
    });
    assert.match(seed, /merge failed in Source Control/i);
    assert.match(seed, /CONFLICT \(content\): file\.ts/);
    assert.match(seed, /\/repo\/\.worktrees\/task-a/);
    assert.match(seed, /Do not run `git merge --abort`/);
  });
});
