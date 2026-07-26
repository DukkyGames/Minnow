/**
 * parseIssueCodeRefPaste pure helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseIssueCodeRefPaste } from '../../src/state/issue-code-ref-parse.ts';

describe('parseIssueCodeRefPaste', () => {
  test('path only', () => {
    const r = parseIssueCodeRefPaste('src/ui/issues-page.ts');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ref.path, 'src/ui/issues-page.ts');
      assert.equal(r.ref.startLine, undefined);
    }
  });

  test('path:start-end', () => {
    const r = parseIssueCodeRefPaste('src/foo.ts:12-34');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ref.path, 'src/foo.ts');
      assert.equal(r.ref.startLine, 12);
      assert.equal(r.ref.endLine, 34);
    }
  });

  test('path:start single line', () => {
    const r = parseIssueCodeRefPaste('src/foo.ts:8');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ref.startLine, 8);
      assert.equal(r.ref.endLine, 8);
    }
  });

  test('normalizes backslashes', () => {
    const r = parseIssueCodeRefPaste('src\\foo.ts:1-2');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ref.path, 'src/foo.ts');
  });

  test('rejects empty', () => {
    const r = parseIssueCodeRefPaste('   ');
    assert.equal(r.ok, false);
  });
});
