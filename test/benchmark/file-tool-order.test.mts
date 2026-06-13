/**
 * File-tool probe order for the benchmark tools suite.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import { FILE_TOOL_PROBE_ORDER } from '../../src/benchmark/suites/file-tool-fixtures.ts';

describe('file tool probe order', () => {
  test('starts with save_file and ends with delete_path', () => {
    assert.equal(FILE_TOOL_PROBE_ORDER[0], 'save_file');
    assert.equal(FILE_TOOL_PROBE_ORDER.at(-1), 'delete_path');
  });

  test('includes every file-category tool exactly once', () => {
    const fileIds = BUILT_IN_TOOLS.filter((t) => t.category === 'files').map((t) => t.id);
    assert.equal(FILE_TOOL_PROBE_ORDER.length, fileIds.length);
    for (const id of fileIds) {
      assert.ok(FILE_TOOL_PROBE_ORDER.includes(id), `missing ${id}`);
    }
    assert.equal(new Set(FILE_TOOL_PROBE_ORDER).size, FILE_TOOL_PROBE_ORDER.length);
  });
});
