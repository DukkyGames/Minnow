/**
 * Spot checks for benchmark test description resolver.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALL_BENCHMARK_SUITE_IDS,
  formatTestCardDescription,
  resolveTestDescription,
  SUITE_INTROS,
} from '../../src/benchmark/test-catalog.ts';

describe('resolveTestDescription', () => {
  test('cap-stream static entry', () => {
    const desc = resolveTestDescription('cap-stream', 'capability', 'Streaming completion');
    assert.ok(desc);
    assert.match(desc.purpose, /stream/i);
    assert.match(desc.passCriteria, /non-empty/i);
  });

  test('speed-short-2 uses timing-only pass criteria', () => {
    const desc = resolveTestDescription('speed-short-2', 'speed', 'Short run 2');
    assert.ok(desc);
    assert.match(desc.passCriteria, /non-empty/i);
    assert.match(desc.passCriteria, /informational|chars/i);
  });

  test('tool-read_file dynamic entry mentions benchmark workspace', () => {
    const desc = resolveTestDescription('tool-read_file', 'tools', 'Read file');
    assert.ok(desc);
    assert.match(desc.method, /benchmark-workspace/i);
    assert.match(desc.passCriteria, /MINNOW_BENCH_MARKER/);
  });

  test('cap-usage documents skip semantics', () => {
    const desc = resolveTestDescription('cap-usage', 'capability', 'Usage metadata');
    assert.ok(desc);
    assert.match(desc.passCriteria, /skip/i);
  });

  test('formatTestCardDescription includes pass line', () => {
    const desc = resolveTestDescription('code-fizzbuzz', 'coding', 'FizzBuzz line');
    assert.ok(desc);
    const text = formatTestCardDescription(desc);
    assert.match(text, /^.+ Pass: /);
    assert.ok(text.length > desc.purpose.length);
  });

  test('cap-matrix entry resolves from catalog metadata', () => {
    const desc = resolveTestDescription(
      'cap-matrix/core-streaming',
      'capability-matrix',
      'Streaming',
    );
    assert.ok(desc);
    assert.equal(desc.suite, 'capability-matrix');
    assert.match(desc.purpose, /streaming/i);
    assert.ok(desc.passCriteria.trim().length > 10);
  });

  test('unknown testId returns null', () => {
    assert.equal(resolveTestDescription('not-a-real-test', 'capability', 'Nope'), null);
  });
});

describe('SUITE_INTROS', () => {
  test('every suite has intro copy', () => {
    for (const id of ALL_BENCHMARK_SUITE_IDS) {
      assert.ok(SUITE_INTROS[id].trim().length > 20, id);
    }
  });
});
