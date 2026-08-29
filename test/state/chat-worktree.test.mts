/**
 * Pure helpers for per-chat worktree composer state (MIN-276).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatComposerBranchLabel,
  formatComposerRunTargetLabel,
  isChatWorktreeMode,
  isManagedChatWorktreePath,
  suggestChatWorktreeBranchName,
} from '../../src/state/chat-worktree.ts';

describe('chat-worktree helpers', () => {
  test('isChatWorktreeMode is true when worktreeRoot is set', () => {
    assert.equal(isChatWorktreeMode({ worktreeRoot: '/tmp/wt' }), true);
    assert.equal(isChatWorktreeMode({ worktreeRoot: '' }), false);
    assert.equal(isChatWorktreeMode({}), false);
  });

  test('formatComposerRunTargetLabel reflects worktree vs local', () => {
    assert.equal(formatComposerRunTargetLabel({}), 'Local');
    assert.equal(formatComposerRunTargetLabel({ worktreeRoot: '/wt' }), 'Worktree');
  });

  test('formatComposerBranchLabel falls back to Branch', () => {
    assert.equal(formatComposerBranchLabel(), 'Branch');
    assert.equal(formatComposerBranchLabel('main'), 'main');
  });

  test('isManagedChatWorktreePath matches sanitized chat slot paths', () => {
    const chatId = 'chat-abc-123';
    const path = `/home/user/.minnow/worktrees/repo-hash/chat/${chatId}`;
    assert.equal(isManagedChatWorktreePath(chatId, path), true);
    assert.equal(isManagedChatWorktreePath(chatId, '/other/path'), false);
  });

  test('suggestChatWorktreeBranchName uses the chat title, not the current branch', () => {
    assert.equal(
      suggestChatWorktreeBranchName({
        name: 'Test Worktree',
        workspacePath: '/tmp/opaque-id',
        gitBranch: 'main',
      }),
      'test-worktree',
    );
  });

  test('suggestChatWorktreeBranchName skips placeholder chat names', () => {
    assert.equal(
      suggestChatWorktreeBranchName(
        { name: 'New chat', workspacePath: '', gitBranch: 'main' },
        '/Users/dev/Minnow',
      ),
      'minnow',
    );
  });
});
