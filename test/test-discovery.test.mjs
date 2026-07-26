/**
 * Guardrails for test discovery: new *.test.* files are picked up automatically.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_TEST_CONCURRENCY, resolveTestConcurrency } from './test-config.mjs';
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

  test('new convention path gets tsx-mocks-loader by default', () => {
    assert.equal(resolveRunner('test/foo/bar.test.mts'), 'tsx-mocks-loader');
    assert.equal(resolveRunner('test/foo/bar.test.mjs'), 'tsx-mocks-loader');
  });

  test('scoped memory suite only includes memory tests', () => {
    const files = listTestsForSuite('memory');
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => f.startsWith('test/memory/')));
  });
});

describe('resolveTestConcurrency', () => {
  const original = process.env.MINNOW_TEST_CONCURRENCY;

  test.after(() => {
    if (original === undefined) {
      delete process.env.MINNOW_TEST_CONCURRENCY;
    } else {
      process.env.MINNOW_TEST_CONCURRENCY = original;
    }
  });

  test('respects valid MINNOW_TEST_CONCURRENCY', () => {
    process.env.MINNOW_TEST_CONCURRENCY = '4';
    assert.equal(resolveTestConcurrency(), 4);
  });

  test('ignores garbage values', () => {
    delete process.env.MINNOW_TEST_CONCURRENCY;
    const defaultVal = resolveTestConcurrency();

    process.env.MINNOW_TEST_CONCURRENCY = 'abc';
    assert.equal(resolveTestConcurrency(), defaultVal);

    process.env.MINNOW_TEST_CONCURRENCY = '0';
    assert.equal(resolveTestConcurrency(), defaultVal);

    process.env.MINNOW_TEST_CONCURRENCY = '-1';
    assert.equal(resolveTestConcurrency(), defaultVal);
  });

  test('never exceeds MAX_TEST_CONCURRENCY when unset', () => {
    delete process.env.MINNOW_TEST_CONCURRENCY;
    assert.ok(resolveTestConcurrency() <= MAX_TEST_CONCURRENCY);
  });
});
