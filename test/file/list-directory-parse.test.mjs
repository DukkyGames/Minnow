import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseListDirectoryResult } from '../../src/lib/list-directory-parse.ts';

describe('parseListDirectoryResult', () => {
  test('mixed entries', () => {
    const result = parseListDirectoryResult('[dir] src\n[file] package.json');
    assert.ok(!('error' in result));
    assert.deepEqual(result.dirs, ['src']);
    assert.deepEqual(result.files, ['package.json']);
  });

  test('empty directory', () => {
    const result = parseListDirectoryResult('(empty directory)');
    assert.ok(!('error' in result));
    assert.deepEqual(result.dirs, []);
    assert.deepEqual(result.files, []);
  });

  test('error passthrough', () => {
    const result = parseListDirectoryResult('Error: access denied');
    assert.deepEqual(result, { error: 'access denied' });
  });

  test('stable sort', () => {
    const result = parseListDirectoryResult(
      '[dir] zeta\n[dir] alpha\n[file] z.txt\n[file] a.txt',
    );
    assert.deepEqual(result.dirs, ['alpha', 'zeta']);
    assert.deepEqual(result.files, ['a.txt', 'z.txt']);
  });
});
