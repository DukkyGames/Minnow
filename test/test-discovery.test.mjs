/**
 * Guardrails for test discovery: new *.test.* files are picked up automatically.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  discoverTestFiles,
  findOrphanTests,
  listTestsForSuite,
  resolveRunner,
} from './test-discovery.mjs';

describe('test discovery', () => {
  test('discovers hundreds of test files under test/', () => {
    const files = discoverTestFiles();
    assert.ok(files.length > 500, `expected large suite, got ${files.length}`);
    assert.ok(files.every((f) => f.startsWith('test/')));
  });

  test('assigns a runner to every non-excluded test file', () => {
    const { orphans, unknownExt } = findOrphanTests();
    assert.deepEqual(orphans, [], `orphan tests: ${orphans.join(', ')}`);
    assert.deepEqual(unknownExt, []);
  });

  test('new convention path gets tsx-loader-mocks by default', () => {
    const runner = resolveRunner('test/foo/bar.test.mts');
    assert.equal(runner, 'tsx-loader-mocks');
  });

  test('scoped memory suite only includes memory tests', () => {
    const files = listTestsForSuite('memory');
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => f.startsWith('test/memory/')));
  });
});
