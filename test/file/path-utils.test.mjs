import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  basename,
  computeMoveDestination,
  dirname,
  isAncestorPath,
  joinTreePath,
  normalizeTreePath,
} from '../../src/ui/file-tree-path.ts';

describe('file-tree-path (DnD move helpers)', () => {
  test('joinTreePath and dirname', () => {
    assert.equal(joinTreePath('src', 'a.ts'), 'src/a.ts');
    assert.equal(dirname('src/lib/foo.ts'), 'src/lib');
    assert.equal(basename('src/lib/foo.ts'), 'foo.ts');
  });

  test('normalizeTreePath uses forward slashes', () => {
    assert.equal(normalizeTreePath('src\\lib'), 'src/lib');
  });

  test('isAncestorPath detects nesting', () => {
    assert.equal(isAncestorPath('src', 'src/lib'), true);
    assert.equal(isAncestorPath('src', 'src'), true);
    assert.equal(isAncestorPath('src', 'lib'), false);
  });

  test('computeMoveDestination rejects no-op same parent', () => {
    assert.equal(computeMoveDestination('src/a.ts', 'src'), null);
  });

  test('computeMoveDestination rejects folder into descendant', () => {
    assert.equal(computeMoveDestination('src', 'src/lib'), null);
  });

  test('computeMoveDestination returns joined path when valid', () => {
    assert.equal(computeMoveDestination('a.ts', 'lib'), 'lib/a.ts');
    assert.equal(computeMoveDestination('lib/util.ts', 'src'), 'src/util.ts');
  });
});
