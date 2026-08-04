/**
 * My Models rows in the top-bar model picker.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';
import {
  dedupLlamaCppModelsAgainstLibrary,
  encodeLibraryModelSelectKey,
  isLibraryModelBinding,
  resolveUpstreamProviderId,
  LIBRARY_MODEL_PROVIDER_ID,
  libraryModelNeedsLoad,
} from '../../src/models/model-select-library.ts';
import type { LibraryModel } from '../../src/models/library.ts';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../../src/providers/types.ts';

describe('model-select-library', () => {
  test('encodeLibraryModelSelectKey uses synthetic provider id', () => {
    const key = encodeLibraryModelSelectKey('gguf:org/repo:weights.gguf');
    const decoded = encodeModelSelectKey(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf');
    assert.equal(key, decoded);
    assert.equal(isLibraryModelBinding(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf'), true);
  });

  test('resolveUpstreamProviderId maps minnow-library to llama-cpp-local', () => {
    assert.equal(
      resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf'),
      LLAMA_CPP_LOCAL_PROVIDER_ID,
    );
    assert.equal(resolveUpstreamProviderId('openai', 'gpt-4o'), 'openai');
  });

  test('dedupLlamaCppModelsAgainstLibrary removes duplicate served labels', () => {
    const library: LibraryModel[] = [
      {
        id: 'gguf:qwen/qwen3:file.gguf',
        name: 'Qwen3-8B',
        repoId: 'qwen/qwen3',
        publisher: 'qwen',
        producerSlug: 'qwen',
        producerName: 'Qwen',
        producerLogoId: 'Qwen3-8B',
        format: 'GGUF',
        quant: 'Q4',
        arch: 'qwen',
        domain: 'chat',
        paramsB: 8,
        contextLength: 32768,
        capabilities: [],
        sizeBytes: 1000,
        path: '/tmp/file.gguf',
        fileName: 'file.gguf',
        source: 'hf-cache',
        servable: true,
        incomplete: false,
        isMoe: false,
      },
    ];
    const results = [
      {
        provider: {
          id: LLAMA_CPP_LOCAL_PROVIDER_ID,
          label: 'llama.cpp',
          baseUrl: 'http://127.0.0.1:8085',
          apiKind: 'openai-v1' as const,
          enabled: true,
        },
        models: [
          { id: 'Qwen3-8B', type: 'llm', state: 'loaded' },
          { id: 'other-model', type: 'llm', state: 'loaded' },
        ],
      },
    ];
    const serves = [
      {
        id: 'serve-1',
        runtime: 'llama-cpp',
        modelPath: '/tmp/file.gguf',
        modelLabel: 'Qwen3-8B',
        port: 8085,
        baseUrl: 'http://127.0.0.1:8085',
        providerId: LLAMA_CPP_LOCAL_PROVIDER_ID,
        status: 'running' as const,
        runId: null,
        pid: 1,
        error: null,
        startedAt: 1,
        stoppedAt: null,
      },
    ];
    const next = dedupLlamaCppModelsAgainstLibrary(results, library, serves);
    assert.equal(next[0].models.length, 1);
    assert.equal(next[0].models[0].id, 'other-model');
  });

  test('libraryModelNeedsLoad reads cache load state', () => {
    const libraryId = 'gguf:org/repo:weights.gguf';
    const key = encodeLibraryModelSelectKey(libraryId);
    const cache = new Map<string, { id: string; type: string; state?: string }>();
    assert.equal(libraryModelNeedsLoad(libraryId, cache), true);
    cache.set(key, { id: libraryId, type: 'llm', state: 'loaded' });
    assert.equal(libraryModelNeedsLoad(libraryId, cache), false);
  });
});
