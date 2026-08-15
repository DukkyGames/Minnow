/**
 * Every benchmark testId emitted by the runner must resolve in test-catalog.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveBenchmarkSuites } from '../../src/benchmark/runner.ts';
import {
  ALL_BENCHMARK_SUITE_IDS,
  listAllExpectedBenchmarkTests,
  listExpectedTestsForSuites,
  PRESET_BENCHMARK_SUITE_IDS,
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
    assert.ok(tests.length >= 140, `expected large battery, got ${tests.length}`);
    for (const t of tests) {
      assertCatalogCovers(t.testId, t.suite, t.label);
    }
  });

  test('capability-matrix suite resolves every catalog testId', () => {
    const tests = listExpectedTestsForSuites(['capability-matrix']);
    assert.equal(tests.length, 58);
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

  test('full preset matches five-suite preset list only', () => {
    const fullSuites = resolveBenchmarkSuites('full');
    const fromPreset = listExpectedTestsForSuites(fullSuites);
    const presetBattery = listExpectedTestsForSuites(PRESET_BENCHMARK_SUITE_IDS);
    assert.deepEqual(fullSuites, PRESET_BENCHMARK_SUITE_IDS);
    assert.equal(fromPreset.length, presetBattery.length);
    assert.ok(!fullSuites.includes('capability-matrix'));
  });

  test('all registered suites include capability-matrix beyond full preset', () => {
    const all = listAllExpectedBenchmarkTests();
    const presetOnly = listExpectedTestsForSuites(PRESET_BENCHMARK_SUITE_IDS);
    assert.equal(all.length, presetOnly.length + 58);
    assert.deepEqual(ALL_BENCHMARK_SUITE_IDS.length, PRESET_BENCHMARK_SUITE_IDS.length + 1);
  });
});
