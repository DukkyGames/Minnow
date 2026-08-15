/**
 * Library roster binding rewrite (minnow-library → llama-cpp-local).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isLibraryModelBinding,
  resolveServedBindingForLibraryId,
} from '../../src/models/model-select-library.ts';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../../src/providers/types.ts';

const LIBRARY_PROVIDER_ID = 'minnow-library';
const LIBRARY_MODEL_ID = 'gguf:org/repo:weights.gguf';

describe('library effective binding for benchmarks', () => {
  test('isLibraryModelBinding recognizes roster rows', () => {
    assert.equal(isLibraryModelBinding(LIBRARY_PROVIDER_ID, LIBRARY_MODEL_ID), true);
    assert.equal(isLibraryModelBinding('openai', LIBRARY_MODEL_ID), false);
  });

  test('resolveServedBindingForLibraryId rewrites to llama-cpp-local', () => {
    const library = [
      {
        id: LIBRARY_MODEL_ID,
        name: 'Weights',
        format: 'GGUF' as const,
        path: '/tmp/weights.gguf',
        repoId: 'org/repo',
        sizeBytes: 1,
        fileName: 'weights.gguf',
        quant: '',
        paramsB: null,
        isMoe: false,
        source: 'cached' as const,
      },
    ];
    const serves = [
      {
        id: 'serve-1',
        runtime: 'llama-cpp',
        modelPath: '/tmp/weights.gguf',
        modelLabel: 'Weights',
        port: 8080,
        baseUrl: 'http://127.0.0.1:8080',
        providerId: LLAMA_CPP_LOCAL_PROVIDER_ID,
        status: 'running' as const,
        runId: 'r1',
        pid: 1,
        error: null,
        startedAt: 0,
        stoppedAt: null,
      },
    ];
    const providerModels = [
      {
        provider: {
          id: LLAMA_CPP_LOCAL_PROVIDER_ID,
          label: 'Llama.cpp',
          baseUrl: 'http://127.0.0.1:8080',
          apiKind: 'openai-v1' as const,
          enabled: true,
        },
        models: [{ id: 'Weights', type: 'llm' as const, state: 'loaded' }],
      },
    ];

    const served = resolveServedBindingForLibraryId(
      LIBRARY_MODEL_ID,
      library,
      serves,
      providerModels,
    );

    assert.ok(served);
    assert.equal(served!.providerId, LLAMA_CPP_LOCAL_PROVIDER_ID);
    assert.equal(served!.modelId, 'Weights');
  });
});
