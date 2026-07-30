import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { productWikiPathFromHash } from '../../src/ui/product-wiki.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import {
  MODE_ALLOWED_GROUPS,
  TOOL_GROUP_IDS,
} from '../../src/chat/modes/tool-groups.ts';

describe('product wiki route', () => {
  test('parses the home route and encoded article deep links', () => {
    assert.equal(productWikiPathFromHash('#/wiki'), 'documentation/README.md');
    assert.equal(
      productWikiPathFromHash('#/wiki/documentation%2Fguides%2Fsetup.md'),
      'documentation/guides/setup.md',
    );
    assert.equal(productWikiPathFromHash('#/desktop'), null);
  });

  test('falls back to home for malformed encoded paths', () => {
    assert.equal(productWikiPathFromHash('#/wiki/%E0%A4%A'), 'documentation/README.md');
  });
});

describe('product wiki tool policy', () => {
  test('registers the read-only official documentation tools', () => {
    const ids = new Set(BUILT_IN_TOOLS.map((tool) => tool.id));
    assert.equal(ids.has('minnow_docs_search'), true);
    assert.equal(ids.has('minnow_docs_read'), true);
    assert.equal(ids.has('minnow_docs_list'), true);
  });

  test('makes official documentation available in every conversation mode', () => {
    const docsGroup = TOOL_GROUP_IDS['minnow-docs'];
    assert.deepEqual(docsGroup, [
      'minnow_docs_search',
      'minnow_docs_read',
      'minnow_docs_list',
    ]);
    for (const [mode, groups] of Object.entries(MODE_ALLOWED_GROUPS)) {
      assert.ok(groups.includes('minnow-docs'), `${mode} should include official Minnow docs`);
    }
  });
});
