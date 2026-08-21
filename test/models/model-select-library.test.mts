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
  libraryBindingNeedsServeLoad,
  resolveLibraryModelIdForChatBinding,
  resolveLibrarySendBinding,
  resolveServedBindingForLibraryId,
  resolveUpstreamProviderId,
  servedContextLength,
  LIBRARY_MODEL_PROVIDER_ID,
  libraryModelNeedsLoad,
} from '../../src/models/model-select-library.ts';
import type { LibraryModel } from '../../src/models/library.ts';
import type { ServeRecord } from '../../src/models/api-client.ts';
import { LLAMA_CPP_LOCAL_PROVIDER_ID, MLX_LM_LOCAL_PROVIDER_ID } from '../../src/providers/types.ts';

/** Fixed serve fixture — override status / id per case. */
const sampleServe = (overrides: Partial<ServeRecord> = {}): ServeRecord => ({
  id: 'serve-1',
  runtime: 'llama-cpp',
  modelPath: '/tmp/file.gguf',
  modelLabel: 'Qwen3-8B',
  port: 8085,
  baseUrl: 'http://127.0.0.1:8085',
  providerId: LLAMA_CPP_LOCAL_PROVIDER_ID,
  status: 'running',
  runId: null,
  pid: 1,
  error: null,
  startedAt: 1,
  stoppedAt: null,
  ...overrides,
});


const sampleLibraryModel = (overrides: Partial<LibraryModel> = {}): LibraryModel => ({
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
  ...overrides,
});

describe('model-select-library', () => {
  test('encodeLibraryModelSelectKey uses synthetic provider id', () => {
    const key = encodeLibraryModelSelectKey('gguf:org/repo:weights.gguf');
    const decoded = encodeModelSelectKey(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf');
    assert.equal(key, decoded);
    assert.equal(isLibraryModelBinding(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf'), true);
    assert.equal(
      isLibraryModelBinding(LIBRARY_MODEL_PROVIDER_ID, 'mlx:org/repo'),
      true,
    );
  });

  test('servedContextLength reports the per-slot window of a running serve', () => {
    // `-c` is ctxPerSlot * parallel, so a 2-slot serve gives each chat half of it.
    assert.equal(
      servedContextLength(sampleServe({ llamaSettings: { ctx: 65_536, parallel: 2 } })),
      32_768,
    );
    assert.equal(
      servedContextLength(sampleServe({ llamaSettings: { ctx: 32_768 } })),
      32_768,
    );
  });

  test('servedContextLength stays undefined without a running serve or ctx', () => {
    assert.equal(servedContextLength(undefined), undefined);
    assert.equal(
      servedContextLength(sampleServe({ status: 'starting', llamaSettings: { ctx: 32_768 } })),
      undefined,
    );
    assert.equal(servedContextLength(sampleServe({ llamaSettings: null })), undefined);
    assert.equal(servedContextLength(sampleServe({ llamaSettings: { ctx: 0 } })), undefined);
  });

  test('resolveUpstreamProviderId maps minnow-library to local runtimes', () => {
    assert.equal(
      resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf'),
      LLAMA_CPP_LOCAL_PROVIDER_ID,
    );
    assert.equal(
      resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, 'mlx:org/repo'),
      MLX_LM_LOCAL_PROVIDER_ID,
    );
    assert.equal(resolveUpstreamProviderId('openai', 'gpt-4o'), 'openai');
  });

  test('resolveUpstreamProviderId maps minnow-library to llama-cpp-local', () => {
    assert.equal(
      resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, 'gguf:org/repo:weights.gguf'),
      LLAMA_CPP_LOCAL_PROVIDER_ID,
    );
    assert.equal(resolveUpstreamProviderId('openai', 'gpt-4o'), 'openai');
  });

  test('dedupLlamaCppModelsAgainstLibrary removes duplicate served labels', () => {
    const library: LibraryModel[] = [sampleLibraryModel()];
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

  test('libraryBindingNeedsServeLoad: no serve → true; running → false; stale cache ignored', () => {
    const model = sampleLibraryModel();
    const library = [model];
    const key = encodeLibraryModelSelectKey(model.id);
    const cache = new Map<string, { id: string; type: string; state?: string }>([
      [key, { id: model.id, type: 'llm', state: 'loaded' }],
    ]);

    // No live serve at all → must load.
    assert.equal(libraryBindingNeedsServeLoad(model.id, library, []), true);
    // Cache says loaded but no serve → still needs load (eject / stale cache).
    assert.equal(libraryBindingNeedsServeLoad(model.id, library, [], cache), true);
    // Starting is not ready for completions.
    assert.equal(
      libraryBindingNeedsServeLoad(model.id, library, [sampleServe({ status: 'starting' })]),
      true,
    );
    // Only a running serve skips the load path.
    assert.equal(
      libraryBindingNeedsServeLoad(model.id, library, [sampleServe({ status: 'running' })], cache),
      false,
    );
  });

  test('resolveLibraryModelIdForChatBinding maps synthetic and remapped upstream ids', () => {
    const model = sampleLibraryModel();
    const library = [model];

    assert.equal(
      resolveLibraryModelIdForChatBinding(LIBRARY_MODEL_PROVIDER_ID, model.id, library),
      model.id,
    );
    assert.equal(
      resolveLibraryModelIdForChatBinding(
        LLAMA_CPP_LOCAL_PROVIDER_ID,
        model.name,
        library,
      ),
      model.id,
      'persisted llama-cpp-local binding after a served turn must map back to the library row',
    );
    assert.equal(
      resolveLibraryModelIdForChatBinding(LLAMA_CPP_LOCAL_PROVIDER_ID, 'unknown-model', library),
      null,
    );
    assert.equal(
      resolveLibraryModelIdForChatBinding('lmstudio', model.name, library),
      null,
    );
  });

  test('resolveServedBindingForLibraryId / resolveLibrarySendBinding need a running serve', () => {
    const model = sampleLibraryModel();
    const library = [model];

    assert.equal(resolveServedBindingForLibraryId(model.id, library, []), null);
    assert.equal(resolveLibrarySendBinding(model.id, library, []), null);

    // Stopped serves are ignored by activeServeFor → null.
    assert.equal(
      resolveServedBindingForLibraryId(model.id, library, [sampleServe({ status: 'stopped' })]),
      null,
    );
    // Starting is not ready for send binding.
    assert.equal(
      resolveLibrarySendBinding(model.id, library, [sampleServe({ status: 'starting' })]),
      null,
    );
    // Unknown library id → null.
    assert.equal(
      resolveLibrarySendBinding('gguf:missing/repo:missing.gguf', library, [
        sampleServe({ status: 'running' }),
      ]),
      null,
    );

    const expected = {
      providerId: LLAMA_CPP_LOCAL_PROVIDER_ID,
      modelId: 'Qwen3-8B',
    };
    assert.deepEqual(
      resolveServedBindingForLibraryId(model.id, library, [sampleServe({ status: 'running' })]),
      expected,
    );
    assert.deepEqual(
      resolveLibrarySendBinding(model.id, library, [sampleServe({ status: 'running' })]),
      expected,
    );
  });

  test('resolveLibrarySendBinding for MLX uses serve directory path for completions', () => {
    const mlxPath = '/Users/me/.minnow/models/artifacts/mlx-community--Qwen-8B-4bit';
    const model = sampleLibraryModel({
      id: 'mlx:mlx-community/Qwen-8B-4bit',
      name: 'Qwen-8B-4bit',
      repoId: 'mlx-community/Qwen-8B-4bit',
      format: 'MLX',
      quant: 'mlx-4bit',
      path: mlxPath,
      fileName: null,
    });
    const library = [model];
    const serve = sampleServe({
      runtime: 'mlx-lm',
      modelPath: mlxPath,
      modelLabel: mlxPath,
      providerId: LIBRARY_MODEL_PROVIDER_ID,
      port: 8087,
      baseUrl: 'http://127.0.0.1:8087',
    });
    const expected = {
      providerId: MLX_LM_LOCAL_PROVIDER_ID,
      modelId: mlxPath,
    };
    assert.deepEqual(resolveServedBindingForLibraryId(model.id, library, [serve]), expected);
    assert.deepEqual(resolveLibrarySendBinding(model.id, library, [serve]), expected);
    // Must not send synthetic picker ids upstream.
    assert.notEqual(expected.modelId, model.id);
  });
});
