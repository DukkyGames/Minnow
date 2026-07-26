/**
 * Guardrails for test discovery: new *.test.* files are picked up automatically.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  HEAVY_TEST_PATH_PREFIXES,
  MAX_TEST_CONCURRENCY,
  MAX_TEST_BATCH_SIZE,
  isHeavyTestPath,
  resolveTestBatchSize,
  resolveTestConcurrency,
} from './test-config.mjs';
import { chunkFiles } from './run-all.mjs';
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

describe('resolveTestBatchSize', () => {
  const original = process.env.MINNOW_TEST_BATCH_SIZE;

  test.after(() => {
    if (original === undefined) {
      delete process.env.MINNOW_TEST_BATCH_SIZE;
    } else {
      process.env.MINNOW_TEST_BATCH_SIZE = original;
    }
  });

  test('defaults to MAX_TEST_BATCH_SIZE', () => {
    delete process.env.MINNOW_TEST_BATCH_SIZE;
    assert.equal(resolveTestBatchSize(), MAX_TEST_BATCH_SIZE);
  });

  test('respects valid MINNOW_TEST_BATCH_SIZE', () => {
    process.env.MINNOW_TEST_BATCH_SIZE = '40';
    assert.equal(resolveTestBatchSize(), 40);
  });

  test('ignores garbage values', () => {
    delete process.env.MINNOW_TEST_BATCH_SIZE;
    const defaultVal = resolveTestBatchSize();

    process.env.MINNOW_TEST_BATCH_SIZE = 'nope';
    assert.equal(resolveTestBatchSize(), defaultVal);

    process.env.MINNOW_TEST_BATCH_SIZE = '0';
    assert.equal(resolveTestBatchSize(), defaultVal);
  });
});

describe('isHeavyTestPath', () => {
  test('matches UI and orchestrate prefixes', () => {
    for (const prefix of HEAVY_TEST_PATH_PREFIXES) {
      assert.equal(isHeavyTestPath(`${prefix}foo.test.mjs`), true);
    }
    assert.equal(isHeavyTestPath('test/memory/store.test.mjs'), false);
  });
});

describe('chunkFiles', () => {
  test('never batches heavy paths with other files', () => {
    const files = [
      'test/memory/a.test.mjs',
      'test/memory/b.test.mjs',
      'test/ui/c.test.mjs',
      'test/memory/d.test.mjs',
    ];
    const chunks = chunkFiles(files, 'tsx-mocks-loader', 60, 8);
    assert.deepEqual(chunks, [
      ['test/memory/a.test.mjs', 'test/memory/b.test.mjs'],
      ['test/ui/c.test.mjs'],
      ['test/memory/d.test.mjs'],
    ]);
  });

  test('defaults to one file per chunk when batch size is 1', () => {
    const files = ['test/memory/a.test.mjs', 'test/memory/b.test.mjs'];
    const chunks = chunkFiles(files, 'tsx-mocks-loader', 1, 1);
    assert.deepEqual(chunks, [['test/memory/a.test.mjs'], ['test/memory/b.test.mjs']]);
  });
});
