import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countPatchLineStats,
  splitPatchIntoFiles,
} from '../../src/ui/git-patch-files.ts';
import {
  alignHunkLines,
  buildSideBySideRowsFromPatch,
} from '../../src/ui/side-by-side-patch-diff.ts';

describe('splitPatchIntoFiles', () => {
  it('splits multi-file patches', () => {
    const patch = `diff --git a/foo.ts b/foo.ts
index abc..def 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new
diff --git a/bar.ts b/bar.ts
index 111..222 100644
--- a/bar.ts
+++ b/bar.ts
@@ -1 +1,2 @@
 context
+added
`;

    const files = splitPatchIntoFiles(patch);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, 'foo.ts');
    assert.equal(files[1].path, 'bar.ts');
    assert.equal(files[0].binary, false);
  });

  it('counts line stats per file patch', () => {
    const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,2 +1,2 @@
 keep
-removed
+added
`;
    const stats = countPatchLineStats(patch);
    assert.deepEqual(stats, { additions: 1, deletions: 1 });
  });
});

describe('buildSideBySideRowsFromPatch', () => {
  it('aligns context and change rows with line numbers', () => {
    const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 unchanged
-removed
+added one
+added two
`;

    const rows = buildSideBySideRowsFromPatch(patch);
    assert.equal(rows[0].left.lineNumber, 1);
    assert.equal(rows[0].right.lineNumber, 1);
    assert.equal(rows[0].left.kind, 'context');
    assert.equal(rows[1].left.kind, 'remove');
    assert.equal(rows[1].right.kind, 'add');
    assert.equal(rows[1].right.text, 'added one');
    assert.equal(rows[2].left.kind, 'gap');
    assert.equal(rows[2].right.kind, 'add');
    assert.equal(rows[2].right.text, 'added two');
  });

  it('pairs single-line modifications on one row', () => {
    const hunk = {
      oldStart: 10,
      newStart: 10,
      lines: [
        { type: 'remove' as const, text: 'before' },
        { type: 'add' as const, text: 'after' },
      ],
    };
    const rows = alignHunkLines(hunk);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].left.text, 'before');
    assert.equal(rows[0].right.text, 'after');
    assert.equal(rows[0].left.lineNumber, 10);
    assert.equal(rows[0].right.lineNumber, 10);
  });
});
