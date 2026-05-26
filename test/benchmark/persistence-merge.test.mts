import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeBenchmarkRunSummaries } from '../../src/benchmark/persistence.ts';

describe('mergeBenchmarkRunSummaries', () => {
  test('prefers server row when ids collide', () => {
    const merged = mergeBenchmarkRunSummaries(
      [
        {
          id: 'run-a',
          startedAt: '2026-05-20T10:00:00.000Z',
          modelId: 'server-model',
          providerId: 'p1',
          totalScore: 0.9,
          headlineTtftMs: 100,
          headlineTokPerSec: 50,
        },
      ],
      [
        {
          id: 'run-a',
          startedAt: '2026-05-20T10:00:00.000Z',
          modelId: 'local-model',
          providerId: 'p1',
          totalScore: 0.5,
          headlineTtftMs: 200,
          headlineTokPerSec: 25,
        },
      ],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.modelId, 'server-model');
  });

  test('merges distinct ids and sorts newest startedAt first', () => {
    const merged = mergeBenchmarkRunSummaries(
      [
        {
          id: 'older',
          startedAt: '2026-05-01T00:00:00.000Z',
          modelId: 'm1',
          providerId: 'p1',
          totalScore: 0.5,
          headlineTtftMs: 0,
          headlineTokPerSec: 0,
        },
      ],
      [
        {
          id: 'newer',
          startedAt: '2026-05-25T00:00:00.000Z',
          modelId: 'm2',
          providerId: 'p1',
          totalScore: 0.8,
          headlineTtftMs: 0,
          headlineTokPerSec: 0,
        },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, 'newer');
    assert.equal(merged[1]?.id, 'older');
  });
});
