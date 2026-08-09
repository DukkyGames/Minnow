/**
 * Chat completions binding — My Models remap for utility requests (expand prompt, etc.).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveChatCompletionsBindingFromCatalog } from '../../src/api/resolve-chat-completions-binding.ts';
import type { LibraryModel } from '../../src/models/library.ts';
import type { ServeRecord } from '../../src/models/api-client.ts';
import {
  LIBRARY_MODEL_PROVIDER_ID,
  encodeLibraryModelSelectKey,
} from '../../src/models/model-select-library.ts';
import { MLX_LM_LOCAL_PROVIDER_ID } from '../../src/providers/types.ts';

const mlxLibraryId = 'mlx:lmstudio-community/Qwen3.6-27B-MLX-8bit';
const mlxPath = '/Users/me/.cache/huggingface/hub/models--lmstudio-community--Qwen3.6-27B-MLX-8bit/snapshots/abc123';

const mlxModel = (): LibraryModel => ({
  id: mlxLibraryId,
  name: 'Qwen3.6-27B-MLX-8bit',
  repoId: 'lmstudio-community/Qwen3.6-27B-MLX-8bit',
  publisher: 'lmstudio-community',
  producerSlug: 'qwen',
  producerName: 'Qwen',
  producerLogoId: 'Qwen3.6-27B-MLX-8bit',
  format: 'MLX',
  quant: '8bit',
  arch: 'qwen',
  domain: 'chat',
  paramsB: 27,
  contextLength: 32768,
  capabilities: [],
  sizeBytes: 1_000_000,
  path: mlxPath,
  fileName: '',
  source: 'hf-cache',
  servable: true,
  incomplete: false,
  isMoe: false,
});

const mlxServe = (): ServeRecord => ({
  id: 'serve-mlx-1',
  runtime: 'mlx-lm',
  modelPath: mlxPath,
  modelLabel: 'Qwen3.6-27B-MLX-8bit',
  port: 8090,
  baseUrl: 'http://127.0.0.1:8090',
  providerId: MLX_LM_LOCAL_PROVIDER_ID,
  status: 'running',
  runId: null,
  pid: 42,
  error: null,
  startedAt: 1,
  stoppedAt: null,
});

describe('resolveChatCompletionsBindingFromCatalog', () => {
  test('remaps minnow-library MLX id to local path when serve is not running', () => {
    const library = [mlxModel()];
    const result = resolveChatCompletionsBindingFromCatalog(
      LIBRARY_MODEL_PROVIDER_ID,
      mlxLibraryId,
      library,
      [],
    );
    assert.equal(result.providerId, MLX_LM_LOCAL_PROVIDER_ID);
    assert.equal(result.modelId, mlxPath);
    assert.deepEqual(result.libraryEnsure, {
      providerId: LIBRARY_MODEL_PROVIDER_ID,
      modelId: mlxLibraryId,
    });
  });

  test('uses running mlx serve binding when available', () => {
    const library = [mlxModel()];
    const serves = [mlxServe()];
    const composite = encodeLibraryModelSelectKey(mlxLibraryId);
    const decodedProvider = LIBRARY_MODEL_PROVIDER_ID;
    const result = resolveChatCompletionsBindingFromCatalog(
      decodedProvider,
      mlxLibraryId,
      library,
      serves,
    );
    assert.equal(result.providerId, MLX_LM_LOCAL_PROVIDER_ID);
    assert.equal(result.modelId, mlxPath);
    assert.ok(result.libraryEnsure);
    assert.notEqual(composite, '');
  });

  test('passes through non-library bindings unchanged', () => {
    const result = resolveChatCompletionsBindingFromCatalog('openai', 'gpt-4o', [], []);
    assert.deepEqual(result, {
      providerId: 'openai',
      modelId: 'gpt-4o',
      libraryEnsure: null,
    });
  });
});
