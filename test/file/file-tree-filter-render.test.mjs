import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const filter = await import('../../src/ui/file-tree-filter.ts');

describe('file-tree filter pipeline', () => {
  test('indexed paths filter and sort for display', () => {
    filter.setWorkspaceIndexForTest('.', ['src/b.ts', 'src/a.ts', 'lib/z.ts']);
    const paths = filter.filterPaths(['src/b.ts', 'src/a.ts', 'lib/z.ts'], 'a');
    assert.deepEqual(paths, ['src/a.ts']);
    const sorted = filter.sortFilteredPaths(['src/b.ts', 'a.ts', 'ab.ts'], 'a');
    assert.equal(sorted[0], 'a.ts');
  });

  test('empty filter on index returns all paths', () => {
    const all = ['src/app.ts', 'readme.md'];
    assert.deepEqual(filter.filterPaths(all, ''), all);
  });

  test('invalidateFileTreeIndex clears test cache', async () => {
    filter.setWorkspaceIndexForTest('.', ['only.ts']);
    filter.invalidateFileTreeIndex();
    const built = await filter.buildWorkspaceIndex('.', async () => ({
      dirs: [],
      files: ['x.ts'],
    }));
    assert.deepEqual(built, ['x.ts']);
  });
});
