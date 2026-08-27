/**
 * First-load capability probe: which local rows get queued, and that we
 * do not probe cloud catalogs or already-flagged VLMs.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { modelCache } from '../../src/app-state.ts';
import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';
import {
  getFirstLoadProbeSeenKeysForTests,
  isFirstLoadProbeCandidate,
  modelNeedsFirstLoadCapabilityProbe,
  resetFirstLoadCapabilityProbeStateForTests,
  resolveFirstLoadProbeTarget,
  scheduleFirstLoadCapabilityProbes,
  setFirstLoadCapabilityProbeRunnerForTests,
  waitForFirstLoadProbesForTests,
} from '../../src/providers/first-load-probe.ts';
import type { ProviderPublic } from '../../src/providers/types.ts';
import type { LmModelRecord } from '../../src/types.ts';

const lmStudio: ProviderPublic = {
  id: 'lm-studio-local',
  label: 'LM Studio',
  baseUrl: 'http://127.0.0.1:1234',
  apiKind: 'lm-studio-v0',
  enabled: true,
  hasApiKey: false,
  hasBearer: false,
};

const cloud: ProviderPublic = {
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  apiKind: 'openai-v1',
  enabled: true,
  hasApiKey: true,
  hasBearer: false,
};

function cacheRow(providerId: string, modelId: string, row: LmModelRecord): void {
  modelCache.set(encodeModelSelectKey(providerId, modelId), row);
}

describe('modelNeedsFirstLoadCapabilityProbe', () => {
  test('probes a bare loaded LLM with no catalog vision', () => {
    assert.equal(
      modelNeedsFirstLoadCapabilityProbe({ id: 'gemma-3-12b-it', type: 'llm', state: 'loaded' }),
      true,
    );
  });

  test('skips a catalog VLM', () => {
    assert.equal(
      modelNeedsFirstLoadCapabilityProbe({ id: 'qwen-omni', type: 'vlm', state: 'loaded' }),
      false,
    );
  });

  test('skips a row a previous probe already settled', () => {
    assert.equal(
      modelNeedsFirstLoadCapabilityProbe({
        id: 'gemma-3-12b-it',
        type: 'llm',
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          grammar: null,
          reasoning: null,
          contextLength: null,
          loadState: 'loaded',
          sources: { vision: 'probe' },
          probeErrors: {},
        },
      }),
      false,
    );
  });
});

describe('isFirstLoadProbeCandidate', () => {
  const lmIds = new Set(['lm-studio-local']);

  test('accepts loaded LM Studio and My Models rows', () => {
    assert.equal(
      isFirstLoadProbeCandidate('lm-studio-local', { id: 'm', state: 'loaded' }, lmIds),
      true,
    );
    assert.equal(
      isFirstLoadProbeCandidate('minnow-library', { id: 'gguf:x', state: 'loaded' }, lmIds),
      true,
    );
    assert.equal(
      isFirstLoadProbeCandidate('llama-cpp-local', { id: 'gguf:x', state: 'loaded' }, lmIds),
      true,
    );
  });

  test('rejects unloaded rows, cloud catalogs, and mlx hub listings', () => {
    assert.equal(
      isFirstLoadProbeCandidate('lm-studio-local', { id: 'm', state: 'not-loaded' }, lmIds),
      false,
    );
    assert.equal(
      isFirstLoadProbeCandidate('openai', { id: 'gpt-4o', state: 'loaded' }, lmIds),
      false,
    );
    assert.equal(
      isFirstLoadProbeCandidate('mlx-lm-local', { id: 'mlx:qwen', state: 'loaded' }, lmIds),
      false,
    );
  });
});

describe('resolveFirstLoadProbeTarget', () => {
  test('maps My Models GGUF ids onto llama-cpp-local', () => {
    const target = resolveFirstLoadProbeTarget(
      'minnow-library',
      'gguf:org/gemma-3:gemma-3-12b-it.gguf',
    );
    assert.equal(target.providerId, 'llama-cpp-local');
    assert.equal(target.modelId, 'gguf:org/gemma-3:gemma-3-12b-it.gguf');
  });

  test('maps My Models MLX ids onto mlx-lm-local', () => {
    const target = resolveFirstLoadProbeTarget('minnow-library', 'mlx:org/model');
    assert.equal(target.providerId, 'mlx-lm-local');
    assert.equal(target.modelId, 'mlx:org/model');
  });
});

describe('scheduleFirstLoadCapabilityProbes', () => {
  afterEach(() => {
    resetFirstLoadCapabilityProbeStateForTests();
    setStorageModeForTests(null);
    modelCache.clear();
  });

  test('does nothing in Vite-only localStorage mode', async () => {
    setStorageModeForTests('localStorage');
    const calls: string[] = [];
    setFirstLoadCapabilityProbeRunnerForTests(async (providerId) => {
      calls.push(providerId);
      return true;
    });
    cacheRow('lm-studio-local', 'gemma-3-12b-it', {
      id: 'gemma-3-12b-it',
      type: 'llm',
      state: 'loaded',
    });
    scheduleFirstLoadCapabilityProbes([{ provider: lmStudio, models: [] }]);
    await waitForFirstLoadProbesForTests();
    assert.deepEqual(calls, []);
  });

  test('queues a loaded LM Studio model whose vision is still unknown', async () => {
    setStorageModeForTests('server');
    const calls: Array<{ providerId: string; modelIds?: string[] }> = [];
    setFirstLoadCapabilityProbeRunnerForTests(async (providerId, options) => {
      calls.push({ providerId, modelIds: options.modelIds });
      return true;
    });
    cacheRow('lm-studio-local', 'gemma-3-12b-it', {
      id: 'gemma-3-12b-it',
      type: 'llm',
      state: 'loaded',
    });
    scheduleFirstLoadCapabilityProbes([{ provider: lmStudio, models: [] }]);
    await waitForFirstLoadProbesForTests();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.providerId, 'lm-studio-local');
    assert.deepEqual(calls[0]?.modelIds, ['gemma-3-12b-it']);
  });

  test('does not queue a catalog VLM or a cloud openai-v1 row', async () => {
    setStorageModeForTests('server');
    const calls: string[] = [];
    setFirstLoadCapabilityProbeRunnerForTests(async (providerId) => {
      calls.push(providerId);
      return true;
    });
    cacheRow('lm-studio-local', 'qwen-omni', { id: 'qwen-omni', type: 'vlm', state: 'loaded' });
    cacheRow('openai', 'gpt-4o', { id: 'gpt-4o', type: 'llm', state: 'loaded' });
    scheduleFirstLoadCapabilityProbes([
      { provider: lmStudio, models: [] },
      { provider: cloud, models: [] },
    ]);
    await waitForFirstLoadProbesForTests();
    assert.deepEqual(calls, []);
  });

  test('maps a loaded My Models row onto llama-cpp-local and only probes once', async () => {
    setStorageModeForTests('server');
    const calls: Array<{ providerId: string; modelIds?: string[] }> = [];
    setFirstLoadCapabilityProbeRunnerForTests(async (providerId, options) => {
      calls.push({ providerId, modelIds: options.modelIds });
      return true;
    });
    const libraryId = 'gguf:org/gemma-3:gemma-3-12b-it.gguf';
    cacheRow('minnow-library', libraryId, {
      id: libraryId,
      type: 'llm',
      state: 'loaded',
    });
    cacheRow('llama-cpp-local', libraryId, {
      id: libraryId,
      type: 'llm',
      state: 'loaded',
    });
    scheduleFirstLoadCapabilityProbes([]);
    await waitForFirstLoadProbesForTests();
    scheduleFirstLoadCapabilityProbes([]);
    await waitForFirstLoadProbesForTests();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.providerId, 'llama-cpp-local');
    assert.deepEqual(calls[0]?.modelIds, [libraryId]);
    assert.equal(getFirstLoadProbeSeenKeysForTests().length, 1);
  });
});
