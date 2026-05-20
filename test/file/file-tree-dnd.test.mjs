import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeMoveDestination } from '../../src/ui/file-tree-path.ts';

describe('file-tree-dnd validation', () => {
  test('computeMoveDestination matrix', () => {
    assert.equal(computeMoveDestination('a.ts', '.'), null);
    assert.equal(computeMoveDestination('docs/a.ts', 'src'), 'src/a.ts');
    assert.equal(computeMoveDestination('src', 'src'), null);
    assert.equal(computeMoveDestination('src', 'src/nested'), null);
    assert.equal(computeMoveDestination('src/a.ts', 'src'), null);
  });
});
