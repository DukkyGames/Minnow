/**
 * Workspace path equality after slash and trailing-separator normalization.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeWorkspacePath,
  workspacePathsEqual,
} from '../../src/lib/normalize-workspace-path.ts';

describe('workspacePathsEqual', () => {
  test('treats trailing slashes and backslashes as the same folder', () => {
    assert.equal(workspacePathsEqual('/home/user/minnow', '/home/user/minnow/'), true);
    assert.equal(
      workspacePathsEqual('C:/Users/dukky/Minnow', 'C:\\Users\\dukky\\Minnow'),
      true,
    );
    assert.equal(normalizeWorkspacePath('/home/user/minnow/'), '/home/user/minnow');
  });

  test('rejects empty or different folders', () => {
    assert.equal(workspacePathsEqual('', '/home/user/minnow'), false);
    assert.equal(workspacePathsEqual('/home/user/a', '/home/user/b'), false);
  });
});
