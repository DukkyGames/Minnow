/**
 * Server-side supervisor config merge + clamps.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeSupervisorConfig } from '../../server/config/validators.js';

describe('mergeSupervisorConfig', () => {
  test('clamps stallMs into range', () => {
    const out = mergeSupervisorConfig({ stallMs: 1_000 }, {});
    assert.equal(out.stallMs, 5_000);
    const hi = mergeSupervisorConfig({ stallMs: 9_000_000 }, {});
    assert.equal(hi.stallMs, 600_000);
  });

  test('merges repetition nested keys', () => {
    const out = mergeSupervisorConfig(
      { repetition: { duplicateToolCallThreshold: 9 } },
      { repetition: { sameErrorThreshold: 4, maxRestartsPerRun: 1 } },
    );
    assert.equal(out.repetition.duplicateToolCallThreshold, 9);
    assert.equal(out.repetition.sameErrorThreshold, 4);
    assert.equal(out.repetition.maxRestartsPerRun, 1);
  });
});
