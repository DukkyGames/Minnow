/**
 * Server line diff stats for file-mutation tools.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  codeChangeFromDiff,
  countAppendLineStats,
  countLineChangeStats,
  countLinesInText,
  normalizeDiffText,
} = await import('../../server/tools/line-diff-stats.js');

describe('line-diff-stats', () => {
  test('normalizeDiffText collapses CRLF and trims line ends', () => {
    assert.equal(normalizeDiffText('a\r\nb  \r\nc'), 'a\nb\nc');
  });

  test('countLineChangeStats counts add and remove lines', () => {
    const stats = countLineChangeStats('alpha\nbeta', 'alpha\ngamma');
    assert.equal(stats.additions, 1);
    assert.equal(stats.deletions, 1);
  });

  test('new file is all additions', () => {
    const stats = countLineChangeStats('', 'one\ntwo');
    assert.equal(stats.additions, 2);
    assert.equal(stats.deletions, 0);
  });

  test('countAppendLineStats treats append as additions only', () => {
    assert.deepEqual(countAppendLineStats('line1\nline2'), {
      additions: 2,
      deletions: 0,
    });
  });

  test('countLinesInText for delete stats', () => {
    assert.equal(countLinesInText('a\nb\nc'), 3);
    assert.equal(countLinesInText(''), 0);
  });

  test('codeChangeFromDiff omits zero stats', () => {
    assert.equal(codeChangeFromDiff('same', 'same', 'x.ts'), undefined);
    const change = codeChangeFromDiff('a', 'b', 'src/x.ts');
    assert.equal(change.path, 'src/x.ts');
    assert.equal(change.additions, 1);
    assert.equal(change.deletions, 1);
  });
});
