import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  FILE_TREE_DEPTH_INDENT_PX,
  FILE_TREE_DIR_BASE_PADDING_PX,
  FILE_TREE_FILE_BASE_PADDING_PX,
} = await import('../../src/ui/file-tree-indent.ts');

describe('file tree layout constants', () => {
  test('file base padding aligns with dir base plus expand width', () => {
    assert.equal(FILE_TREE_FILE_BASE_PADDING_PX, FILE_TREE_DIR_BASE_PADDING_PX + 18);
  });

  test('depth 2 padding matches exported constants', () => {
    const depth = 2;
    const dirPx = FILE_TREE_DIR_BASE_PADDING_PX + depth * FILE_TREE_DEPTH_INDENT_PX;
    const filePx = FILE_TREE_FILE_BASE_PADDING_PX + depth * FILE_TREE_DEPTH_INDENT_PX;
    assert.equal(dirPx, 30);
    assert.equal(filePx, 48);
  });
});
