/**
 * Capability matrix row score formula tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { capabilityRowScore, capabilityRowTestedCount } from '../../src/benchmark/capabilities/score.ts';
import type { CapabilityVerdict } from '../../src/benchmark/capabilities/types.ts';

describe('capabilityRowScore', () => {
  test('returns null for all-untested (not zero)', () => {
    const verdicts: CapabilityVerdict[] = ['untested', 'untested', 'n-a'];
    assert.equal(capabilityRowScore(verdicts), null);
    assert.equal(capabilityRowTestedCount(verdicts), 0);
  });

  test('matches spreadsheet formula with partial weight', () => {
    const verdicts: CapabilityVerdict[] = ['pass', 'partial', 'fail', 'n-a', 'untested'];
    assert.equal(capabilityRowScore(verdicts), (1 + 0.5) / 3);
    assert.equal(capabilityRowTestedCount(verdicts), 3);
  });

  test('all pass yields 1', () => {
    assert.equal(capabilityRowScore(['pass', 'pass']), 1);
  });
});
