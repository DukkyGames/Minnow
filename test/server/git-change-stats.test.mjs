/**
 * Git numstat parsing for commit codeChange payloads.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { parseGitNumstat } = await import('../../server/tools/git-change-stats.js');

describe('git-change-stats', () => {
  test('parseGitNumstat sums tab-separated rows', () => {
    const text = ['3\t1\tsrc/a.ts', '10\t0\tsrc/b.ts', ''].join('\n');
    const parsed = parseGitNumstat(text);
    assert.equal(parsed.additions, 13);
    assert.equal(parsed.deletions, 1);
    assert.deepEqual(parsed.paths, ['src/a.ts', 'src/b.ts']);
  });

  test('parseGitNumstat skips binary placeholders', () => {
    const text = '-\t-\tbinary.dat\n2\t0\tx.ts';
    const parsed = parseGitNumstat(text);
    assert.equal(parsed.additions, 2);
    assert.equal(parsed.deletions, 0);
    assert.deepEqual(parsed.paths, ['x.ts']);
  });
});
