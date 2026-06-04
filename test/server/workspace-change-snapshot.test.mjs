/**
 * Workspace snapshot delta helpers (no live git required).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { diffNumstatSnapshots, parseGitNumstat } = await import(
  '../../server/tools/workspace-change-snapshot.js'
);

describe('workspace-change-snapshot', () => {
  test('diffNumstatSnapshots subtracts aggregate stats', () => {
    const before = { additions: 5, deletions: 2, paths: ['a.ts'] };
    const after = { additions: 12, deletions: 4, paths: ['a.ts', 'b.ts'] };
    const delta = diffNumstatSnapshots(before, after);
    assert.equal(delta.additions, 7);
    assert.equal(delta.deletions, 2);
    assert.ok(delta.paths.includes('a.ts'));
    assert.ok(delta.paths.includes('b.ts'));
  });

  test('diffNumstatSnapshots returns zero when unchanged', () => {
    const snap = { additions: 3, deletions: 1, paths: ['x.ts'] };
    const delta = diffNumstatSnapshots(snap, snap);
    assert.equal(delta.additions, 0);
    assert.equal(delta.deletions, 0);
  });

  test('re-exports parseGitNumstat', () => {
    assert.equal(parseGitNumstat('1\t0\ta.ts').additions, 1);
  });
});
