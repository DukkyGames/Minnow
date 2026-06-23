import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseUnifiedPatchToDiffLines } from '../../src/ui/git-patch-parse.ts';

describe('parseUnifiedPatchToDiffLines', () => {
  it('parses hunk lines after @@ headers', () => {
    const patch = `diff --git a/foo.ts b/foo.ts
index abc..def 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 unchanged
-removed
+added
`;

    const lines = parseUnifiedPatchToDiffLines(patch);
    assert.deepEqual(lines, [
      { type: 'unchanged', text: 'unchanged' },
      { type: 'remove', text: 'removed' },
      { type: 'add', text: 'added' },
    ]);
  });

  it('ignores file headers and no newline markers', () => {
    const patch = `--- a/x
+++ b/x
@@ -0,0 +1,2 @@
+line one
\\ No newline at end of file
`;

    const lines = parseUnifiedPatchToDiffLines(patch);
    assert.deepEqual(lines, [{ type: 'add', text: 'line one' }]);
  });
});
