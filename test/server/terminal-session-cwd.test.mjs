/**
 * resolvePtySessionCwd — PTY session cwd from chat worktree (MIN-349).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { resolvePtySessionCwd } from '../../server/terminal/session-cwd.js';
import { getWorktreesRoot } from '../../server/worktree/paths.js';

const PROJECT_ROOT = path.resolve(process.cwd());
const WORKTREE = path.join(getWorktreesRoot(), 'test-repo', 'board', 'task-W1-A');
const EXPLICIT_WORKTREE = path.join(
  getWorktreesRoot(),
  'test-repo',
  'board',
  'explicit-task',
);
const CHAT_ID = '11111111-1111-1111-1111-111111111111';

describe('resolvePtySessionCwd', () => {
  it('uses project root when no chat or cwd', async () => {
    const cwd = await resolvePtySessionCwd(PROJECT_ROOT, {});
    assert.equal(cwd, PROJECT_ROOT);
  });

  it('resolves chat worktree when chatId is set', async () => {
    const cwd = await resolvePtySessionCwd(PROJECT_ROOT, { chatId: CHAT_ID }, async () =>
      WORKTREE,
    );
    assert.equal(cwd, WORKTREE);
  });

  it('prefers explicit cwd over chat worktree', async () => {
    await fs.mkdir(EXPLICIT_WORKTREE, { recursive: true });
    const cwd = await resolvePtySessionCwd(
      PROJECT_ROOT,
      { chatId: CHAT_ID, cwd: EXPLICIT_WORKTREE },
      async () => WORKTREE,
    );
    assert.equal(path.resolve(cwd), path.resolve(EXPLICIT_WORKTREE));
  });

  it('falls back to project root when chat has no worktree', async () => {
    const cwd = await resolvePtySessionCwd(
      PROJECT_ROOT,
      { chatId: CHAT_ID },
      async () => undefined,
    );
    assert.equal(cwd, PROJECT_ROOT);
  });
});
