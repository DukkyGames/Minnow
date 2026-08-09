/**
 * Utility request paths (prompt expander, inline completion, intent coding) must
 * remap My Models rows onto the running serve before hitting /api/generations.
 *
 * Only the models API is mocked — the library build, MLX gating, and serve
 * matching underneath are the real implementations.
 *
 * Do not statically import the module under test: ES import hoisting would load
 * it before mock.module runs and the mocks would never apply.
 */
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

import type { CachedModelRow, ServeRecord } from '../../src/models/api-client.ts';
import {
  LLAMA_CPP_LOCAL_PROVIDER_ID,
  MLX_LM_LOCAL_PROVIDER_ID,
} from '../../src/providers/types.ts';

const LIBRARY_PROVIDER_ID = 'minnow-library';
const MLX_SNAPSHOT = '/models/hub/mlx-community--Ornith-35B/snapshots/abc123';
const GGUF_PATH = '/models/hub/qwen--Qwen3.5-9B/weights.Q4_K_M.gguf';

const MLX_ROW: CachedModelRow = {
  repo_id: 'mlx-community/Ornith-35B-4bit',
  size_bytes: 20_000,
  nb_files: 4,
  has_incomplete: false,
  path: '/models/hub/mlx-community--Ornith-35B',
  mlx_root: MLX_SNAPSHOT,
  mlx_quant: 'mlx-4bit',
  mlx_context_length: 32_768,
};

const GGUF_ROW: CachedModelRow = {
  repo_id: 'qwen/Qwen3.5-9B',
  size_bytes: 6_000,
  nb_files: 1,
  has_incomplete: false,
  path: '/models/hub/qwen--Qwen3.5-9B',
  is_gguf: true,
  // Local dir keeps the built path a plain join, matching GGUF_PATH below.
  is_local_dir: true,
  gguf_files: [
    {
      name: 'Qwen3.5-9B.Q4_K_M.gguf',
      rel_path: 'weights.Q4_K_M.gguf',
      size_bytes: 6_000,
      role: 'model',
      quant: 'Q4_K_M',
    },
  ],
};

const MLX_LIBRARY_ID = `mlx:${MLX_ROW.repo_id}`;
const GGUF_LIBRARY_ID = `gguf:${GGUF_ROW.repo_id}:weights.Q4_K_M.gguf`;

/** Serves the mocked models API reports; reassigned per case. */
let serves: ServeRecord[] = [];

const serveRecord = (overrides: Partial<ServeRecord> = {}): ServeRecord => ({
  id: 'serve-1',
  runtime: 'mlx-lm',
  modelPath: MLX_SNAPSHOT,
  modelLabel: 'Ornith-35B-4bit',
  port: 8086,
  baseUrl: 'http://127.0.0.1:8086',
  providerId: MLX_LM_LOCAL_PROVIDER_ID,
  status: 'running',
  runId: null,
  pid: 1,
  error: null,
  startedAt: 1,
  stoppedAt: null,
  ...overrides,
});

mock.module('../../src/models/api-client.ts', {
  namedExports: {
    fetchCachedModels: async (): Promise<CachedModelRow[]> => [MLX_ROW, GGUF_ROW],
    listModelServes: async (): Promise<ServeRecord[]> => serves,
  },
});

// MLX rows are filtered out of the library unless the backend is Metal.
mock.module('../../src/models/hardware-client.ts', {
  namedExports: {
    fetchHardware: async () => ({ backend: 'metal' }),
  },
});

const { resolveLibraryRequestBinding } = await import(
  '../../src/models/library-request-binding.ts'
);

describe('resolveLibraryRequestBinding', () => {
  test('passes a registry provider through untouched', async () => {
    serves = [];
    const resolved = await resolveLibraryRequestBinding('lm-studio-local', 'qwen3.5-9b');
    assert.deepEqual(resolved, {
      kind: 'direct',
      providerId: 'lm-studio-local',
      modelId: 'qwen3.5-9b',
    });
  });

  test('maps a served MLX row to mlx-lm-local plus the snapshot path', async () => {
    serves = [serveRecord()];
    const resolved = await resolveLibraryRequestBinding(
      LIBRARY_PROVIDER_ID,
      MLX_LIBRARY_ID,
    );
    assert.deepEqual(resolved, {
      kind: 'served',
      providerId: MLX_LM_LOCAL_PROVIDER_ID,
      // mlx_lm.server keys requests by directory, never by the picker id.
      modelId: MLX_SNAPSHOT,
      libraryModelId: MLX_LIBRARY_ID,
    });
  });

  test('maps a served GGUF row to llama-cpp-local plus the serve label', async () => {
    serves = [
      serveRecord({
        id: 'serve-2',
        runtime: 'llama-cpp',
        modelPath: GGUF_PATH,
        modelLabel: 'Qwen3.5-9B.Q4_K_M',
        providerId: LLAMA_CPP_LOCAL_PROVIDER_ID,
      }),
    ];
    const resolved = await resolveLibraryRequestBinding(
      LIBRARY_PROVIDER_ID,
      GGUF_LIBRARY_ID,
    );
    assert.equal(resolved.kind, 'served');
    assert.equal(
      resolved.kind === 'served' ? resolved.providerId : null,
      LLAMA_CPP_LOCAL_PROVIDER_ID,
    );
  });

  test('reports needsLoad instead of letting the caller fall back to another provider', async () => {
    serves = [];
    const resolved = await resolveLibraryRequestBinding(
      LIBRARY_PROVIDER_ID,
      MLX_LIBRARY_ID,
    );
    assert.deepEqual(resolved, { kind: 'needsLoad', libraryModelId: MLX_LIBRARY_ID });
  });

  test('reports needsLoad for a stopped serve', async () => {
    serves = [serveRecord({ status: 'stopped', stoppedAt: 2 })];
    const resolved = await resolveLibraryRequestBinding(
      LIBRARY_PROVIDER_ID,
      MLX_LIBRARY_ID,
    );
    assert.deepEqual(resolved, { kind: 'needsLoad', libraryModelId: MLX_LIBRARY_ID });
  });

  test('refuses an unknown synthetic id rather than routing it somewhere', async () => {
    serves = [];
    const resolved = await resolveLibraryRequestBinding(
      LIBRARY_PROVIDER_ID,
      'mlx:not/in-library',
    );
    assert.deepEqual(resolved, {
      kind: 'needsLoad',
      libraryModelId: 'mlx:not/in-library',
    });
  });

  test('re-resolves a persisted mlx-lm-local binding onto the live serve', async () => {
    serves = [serveRecord()];
    // A prior served turn persists the upstream ids onto the chat, not the picker key.
    const resolved = await resolveLibraryRequestBinding(
      MLX_LM_LOCAL_PROVIDER_ID,
      MLX_SNAPSHOT,
    );
    assert.equal(resolved.kind, 'served');
    assert.equal(resolved.kind === 'served' ? resolved.modelId : null, MLX_SNAPSHOT);
  });
});
