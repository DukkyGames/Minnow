import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  basename,
  dirname,
  isAncestorPath,
  isValidEntryName,
  joinTreePath,
  normalizeTreePath,
  pruneExpandedDirs,
  remapExpandedDirs,
} from '../../src/ui/file-tree-path.ts';
import {
  clearFileTreeClipboard,
  getFileTreeClipboard,
  setFileTreeClipboard,
} from '../../src/ui/file-tree-clipboard.ts';
import {
  friendlyFileToolError,
  parseToolResult,
} from '../../src/ui/file-tree-parse-result.ts';
import { pasteTargetDirForPath } from '../../src/ui/file-tree-path.ts';

describe('parseToolResult', () => {
  test('success when content does not start with Error:', () => {
    const r = parseToolResult('Deleted foo.ts');
    assert.equal(r.ok, true);
    assert.equal(r.message, 'Deleted foo.ts');
  });

  test('failure when content starts with Error:', () => {
    const r = parseToolResult('Error: path outside workspace');
    assert.equal(r.ok, false);
    assert.match(r.message, /outside workspace/i);
  });

  test('EBUSY maps to actionable rename message', () => {
    const r = parseToolResult(
      "Error: EBUSY: resource busy or locked, rename 'a.ts' -> 'b.ts'",
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /in use/i);
  });

  test('friendlyFileToolError handles EPERM', () => {
    assert.match(
      friendlyFileToolError('EPERM: permission denied'),
      /permission denied/i,
    );
  });
});

describe('file-tree-path helpers', () => {
  test('joinTreePath and dirname', () => {
    assert.equal(joinTreePath('src', 'ui'), 'src/ui');
    assert.equal(dirname('src/ui/file.ts'), 'src/ui');
    assert.equal(basename('src/ui/file.ts'), 'file.ts');
  });

  test('normalizeTreePath uses forward slashes', () => {
    assert.equal(normalizeTreePath('src\\ui\\a.ts'), 'src/ui/a.ts');
  });

  test('isAncestorPath', () => {
    assert.equal(isAncestorPath('src', 'src/ui'), true);
    assert.equal(isAncestorPath('src/ui', 'src'), false);
  });

  test('pruneExpandedDirs removes deleted dir and children', () => {
    const next = pruneExpandedDirs(['src', 'src/ui', 'docs'], 'src');
    assert.deepEqual(next, ['docs']);
  });

  test('remapExpandedDirs after rename', () => {
    const next = remapExpandedDirs(['src', 'src/ui'], 'src', 'lib');
    assert.deepEqual(next, ['lib', 'lib/ui']);
  });

  test('isValidEntryName rejects slashes and empty', () => {
    assert.equal(isValidEntryName('ok.ts'), true);
    assert.equal(isValidEntryName('bad/name'), false);
    assert.equal(isValidEntryName(''), false);
  });

  test('joinTreePath for create under nested parent', () => {
    assert.equal(joinTreePath('src/ui', 'widget.ts'), 'src/ui/widget.ts');
  });
});

describe('file tree clipboard', () => {
  test('set and clear clipboard', () => {
    clearFileTreeClipboard();
    assert.equal(getFileTreeClipboard(), null);
    setFileTreeClipboard('cut', ['src/a.ts']);
    assert.deepEqual(getFileTreeClipboard(), { mode: 'cut', paths: ['src/a.ts'] });
    clearFileTreeClipboard();
    assert.equal(getFileTreeClipboard(), null);
  });

  test('pasteTargetDirForPath', () => {
    assert.equal(pasteTargetDirForPath('src/ui', 'dir'), 'src/ui');
    assert.equal(pasteTargetDirForPath('src/ui/a.ts', 'file'), 'src/ui');
  });
});
