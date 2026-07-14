import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getCachedDesktopWorkspacePath,
  isDesktopWorkspacePath,
  resetDesktopWorkspacePathCache,
} from '../../src/lib/desktop-workspace.ts';

describe('desktop-workspace client', () => {
  beforeEach(() => {
    resetDesktopWorkspacePathCache();
  });

  afterEach(() => {
    resetDesktopWorkspacePathCache();
  });

  test('isDesktopWorkspacePath matches normalized paths', () => {
    const root = '/home/user/.minnow/workspace';
    assert.equal(isDesktopWorkspacePath('/home/user/.minnow/workspace', root), true);
    assert.equal(isDesktopWorkspacePath('/home/user/.minnow/workspace/notes.md', root), false);
    assert.equal(isDesktopWorkspacePath('/home/user/.minnow/chats', root), false);
  });

  test('getCachedDesktopWorkspacePath returns null before fetch', () => {
    assert.equal(getCachedDesktopWorkspacePath(), null);
  });
});
