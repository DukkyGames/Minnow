/**
 * Every benchmark testId emitted by the runner must resolve in test-catalog.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveBenchmarkSuites } from '../../src/benchmark/runner.ts';
import {
  listAllExpectedBenchmarkTests,
  listExpectedTestsForSuites,
  resolveTestDescription,
} from '../../src/benchmark/test-catalog.ts';
import type { SuiteId } from '../../src/benchmark/types.ts';

function assertCatalogCovers(testId: string, suite: SuiteId, label: string): void {
  const desc = resolveTestDescription(testId, suite, label);
  assert.ok(desc, `missing catalog entry for ${suite}/${testId}`);
  assert.ok(desc.purpose.trim(), `${testId}: purpose`);
  assert.ok(desc.passCriteria.trim(), `${testId}: passCriteria`);
  assert.ok(desc.method.trim(), `${testId}: method`);
}

describe('benchmark test catalog coverage', () => {
  test('full battery resolves every emitted testId', () => {
    const tests = listAllExpectedBenchmarkTests();
    assert.ok(tests.length >= 80, `expected large battery, got ${tests.length}`);
    for (const t of tests) {
      assertCatalogCovers(t.testId, t.suite, t.label);
    }
  });

  test('quick preset suites resolve', () => {
    const suiteIds = resolveBenchmarkSuites('quick');
    const tests = listExpectedTestsForSuites(suiteIds);
    for (const t of tests) {
      assertCatalogCovers(t.testId, t.suite, t.label);
    }
  });

  test('full preset matches all-suite list', () => {
    const fullSuites = resolveBenchmarkSuites('full');
    const fromPreset = listExpectedTestsForSuites(fullSuites);
    const all = listAllExpectedBenchmarkTests();
    assert.equal(fromPreset.length, all.length);
  });
});
