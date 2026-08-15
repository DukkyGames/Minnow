/**
 * Benchmark model lifecycle — pure helpers and server gate.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LIBRARY_MODEL_PROVIDER_ID } from '../../src/models/model-select-library.ts';

const LIBRARY_MODEL_ID = 'gguf:org/repo:weights.gguf';

describe('model lifecycle helpers', () => {
  test('diffTraySnapshotDelta returns only new tray rows', async () => {
    const { diffTraySnapshotDelta } = await import('../../src/benchmark/model-lifecycle.ts');
    const before = {
      count: 1,
      names: ['a'],
      rows: [
        {
          id: 'm1',
          providerId: 'lm-studio',
          label: 'a',
          source: 'lm-studio' as const,
        },
      ],
    };
    const after = {
      count: 2,
      names: ['a', 'b'],
      rows: [
        ...before.rows,
        {
          id: 'serve-1',
          providerId: 'llama-cpp-local',
          label: 'b',
          source: 'minnow-serve' as const,
        },
      ],
    };
    const delta = diffTraySnapshotDelta(before, after);
    assert.equal(delta.length, 1);
    assert.equal(delta[0]!.id, 'serve-1');
  });

  test('isLocalBenchmarkTarget classifies hosting bands', async () => {
    const { isLocalBenchmarkTarget } = await import('../../src/benchmark/model-lifecycle.ts');
    assert.equal(
      isLocalBenchmarkTarget({ providerId: LIBRARY_MODEL_PROVIDER_ID, modelId: LIBRARY_MODEL_ID }),
      true,
    );
    assert.equal(
      isLocalBenchmarkTarget({ providerId: 'lm-studio', modelId: 'qwen' }),
      true,
    );
    assert.equal(
      isLocalBenchmarkTarget({ providerId: 'openai', modelId: 'gpt-4' }),
      false,
    );
  });
});
