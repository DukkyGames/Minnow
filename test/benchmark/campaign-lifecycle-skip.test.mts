/**
 * Campaign skip path — load failures must not emit zero-score aggregates.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  aggregateFromTargetWorkResult,
  campaignTargetProducesAggregate,
} from '../../src/benchmark/campaign-runner.ts';

describe('campaign lifecycle skip path', () => {
  test('skipped target work does not produce an aggregate', () => {
    const target = { providerId: 'lm-studio', modelId: 'missing' };
    const skipped = {
      target,
      runs: [],
      cells: [],
      skipped: true,
      skipReason: 'VRAM full',
    };

    assert.equal(campaignTargetProducesAggregate(skipped), false);
    assert.equal(aggregateFromTargetWorkResult(skipped), null);
  });

  test('completed target work still produces an aggregate', () => {
    const target = { providerId: 'openai', modelId: 'gpt-test' };
    const done = {
      target,
      runs: [
        {
          id: 'run-1',
          startedAt: '2026-01-01T00:00:00.000Z',
          durationMs: 100,
          preset: 'quick' as const,
          provider: { id: 'openai', baseUrl: 'https://api.openai.com' },
          model: { id: 'gpt-test' },
          totalScore: 0.75,
          headlineTokPerSec: 80,
          headlineTtftMs: 200,
          modeMatrixPassed: 0,
          toolsPassed: 0,
          skillsPassed: 0,
          suites: [],
        },
      ],
      cells: [],
    };

    assert.equal(campaignTargetProducesAggregate(done), true);
    const agg = aggregateFromTargetWorkResult(done);
    assert.ok(agg);
    assert.equal(agg!.totalScore, 0.75);
    assert.equal(agg!.targetKey, 'openai::gpt-test');
  });
});
