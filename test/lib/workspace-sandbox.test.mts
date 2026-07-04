import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isMinnowSandboxWorkspacePath } from '../../src/lib/workspace-sandbox.ts';

describe('workspace-sandbox', () => {
  test('detects desktop and chats sandboxes', () => {
    assert.equal(isMinnowSandboxWorkspacePath('/home/user/.minnow/workspace'), true);
    assert.equal(isMinnowSandboxWorkspacePath('/home/user/.minnow/chats'), true);
    assert.equal(isMinnowSandboxWorkspacePath('C:\\Users\\me\\.minnow\\workspace'), true);
  });

  test('rejects project workspaces', () => {
    assert.equal(isMinnowSandboxWorkspacePath('C:/Users/me/projects/app'), false);
    assert.equal(isMinnowSandboxWorkspacePath('/home/user/.minnow/benchmark-workspace'), false);
  });
});
