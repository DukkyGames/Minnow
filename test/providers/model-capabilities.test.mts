/**
 * Client merge: catalog vs probe precedence.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyProviderCapabilities,
  catalogCapabilitiesFromRow,
  catalogRowHasVision,
  mergeModelCapabilities,
  prioritizeModelIdsForProbe,
  resolveSendCapabilities,
} from '../../src/providers/model-capabilities.ts';
import { modelCache } from '../../src/app-state.ts';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';

describe('mergeModelCapabilities', () => {
  test('catalog vision wins for vlm over probe false', () => {
    const row = { id: 'x', type: 'vlm', max_context_length: 32768 };
    const merged = mergeModelCapabilities(row, {
      vision: false,
      tools: true,
      streaming: true,
      grammar: null,
      reasoning: null,
      contextLength: null,
      loadState: null,
      sources: { vision: 'catalog', tools: 'probe' },
      probeErrors: {},
    });
    assert.equal(merged.vision, true);
    assert.equal(merged.tools, true);
    assert.equal(merged.contextLength, 32768);
  });

  test('probe fills tools when catalog unknown', () => {
    const row = { id: 'y', type: 'llm' };
    const merged = mergeModelCapabilities(row, {
      vision: false,
      tools: true,
      streaming: true,
      grammar: null,
      reasoning: null,
      contextLength: null,
      loadState: 'loaded',
      sources: { tools: 'probe', streaming: 'probe' },
      probeErrors: {},
    });
    assert.equal(merged.tools, true);
    assert.equal(merged.streaming, true);
  });
});

describe('catalogCapabilitiesFromRow', () => {
  test('marks vlm as vision', () => {
    const caps = catalogCapabilitiesFromRow({ id: 'v', type: 'vlm' });
    assert.equal(caps.vision, true);
  });

  test('marks catalogVision on llm type as vision', () => {
    const caps = catalogCapabilitiesFromRow({
      id: 'qwen',
      type: 'llm',
      catalogVision: true,
    });
    assert.equal(caps.vision, true);
    assert.equal(catalogRowHasVision({ id: 'qwen', type: 'llm', catalogVision: true }), true);
  });

  test('Qwen3.8 defaults thinking on at high (wire xhigh)', () => {
    const caps = catalogCapabilitiesFromRow(
      { id: 'qwen/qwen3.8-27b', type: 'vlm' },
      'openai-v1',
    );
    assert.deepEqual(caps.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps.reasoningDefault, 'high');
  });

  test('Qwen3.8 infers levels without apiKind (My Models / llama.cpp rows)', () => {
    const caps = catalogCapabilitiesFromRow({
      id: 'gguf:unsloth/Qwen3.8-27B-GGUF:Qwen3.8-27B-Q4_K_M.gguf',
      type: 'llm',
    });
    assert.deepEqual(caps.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps.reasoningDefault, 'high');
  });

  test('Qwen3.8 upgrades LM Studio off/on catalog to effort levels', () => {
    const caps = catalogCapabilitiesFromRow(
      {
        id: 'qwen/qwen3.8-27b',
        type: 'vlm',
        reasoning: { allowed_options: ['off', 'on'], default: 'on' },
      },
      'lm-studio-v0',
    );
    assert.deepEqual(caps.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps.reasoningDefault, 'high');
  });

  test('maps LM Studio xhigh catalog default onto high', () => {
    const caps = catalogCapabilitiesFromRow({
      id: 'qwen/qwen3.8-27b',
      type: 'vlm',
      reasoning: {
        allowed_options: ['xhigh', 'medium', 'low', 'off'],
        default: 'xhigh',
      },
    });
    assert.deepEqual(caps.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps.reasoningDefault, 'high');
  });
});

describe('prioritizeModelIdsForProbe', () => {
  test('respects loaded cache state', () => {
    modelCache.clear();
    modelCache.set('loaded-one', { id: 'loaded-one', state: 'loaded' });
    modelCache.set('other', { id: 'other', state: 'not loaded' });
    const out = prioritizeModelIdsForProbe(
      ['other', 'loaded-one', 'zzz'],
      'zzz',
    );
    assert.equal(out[0], 'zzz');
    assert.equal(out[1], 'loaded-one');
  });
});

describe('applyProviderCapabilities', () => {
  test('stamps llama-cpp-local probe vision onto the matching My Models row', () => {
    modelCache.clear();
    const libraryId = 'gguf:org/gemma-3:gemma-3-12b-it.gguf';
    modelCache.set(encodeModelSelectKey('minnow-library', libraryId), {
      id: libraryId,
      type: 'llm',
      state: 'loaded',
    });
    applyProviderCapabilities({
      schemaVersion: 1,
      providerId: 'llama-cpp-local',
      probedAt: '2026-08-27T00:00:00.000Z',
      apiKind: 'openai-v1',
      models: {
        [libraryId]: {
          vision: true,
          tools: true,
          streaming: true,
          grammar: null,
          reasoning: null,
          contextLength: null,
          loadState: 'loaded',
          sources: { vision: 'probe', tools: 'probe', streaming: 'probe' },
          probeErrors: {},
        },
      },
    });
    const row = modelCache.get(encodeModelSelectKey('minnow-library', libraryId));
    assert.equal(row?.capabilities?.vision, true);
    assert.equal(row?.capabilities?.sources?.vision, 'probe');
  });
});

describe('resolveSendCapabilities', () => {
  test('Qwen3.8 library row without capabilities still exposes levels', () => {
    modelCache.clear();
    const modelId = 'gguf:unsloth/Qwen3.8-27B-GGUF:Qwen3.8-27B-Q4_K_M.gguf';
    modelCache.set(encodeModelSelectKey('minnow-library', modelId), {
      id: modelId,
      type: 'llm',
    });
    const caps = resolveSendCapabilities('minnow-library', modelId);
    assert.deepEqual(caps?.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps?.reasoningDefault, 'high');
  });

  test('Qwen3.8 without a cache row still exposes levels for the composer', () => {
    modelCache.clear();
    const caps = resolveSendCapabilities('llama-cpp-local', 'Qwen3.8-27B-Q4_K_M');
    assert.deepEqual(caps?.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps?.reasoningDefault, 'high');
  });

  test('cached off/on for Qwen3.8 is upgraded to levels from catalog', () => {
    modelCache.clear();
    modelCache.set(encodeModelSelectKey('lmstudio', 'qwen/qwen3.8-27b'), {
      id: 'qwen/qwen3.8-27b',
      type: 'vlm',
      api: 'lm-studio-v0',
      capabilities: {
        vision: true,
        tools: null,
        streaming: null,
        grammar: null,
        reasoning: true,
        reasoningAllowedOptions: ['off', 'on'],
        reasoningDefault: 'on',
        contextLength: null,
        loadState: 'loaded',
      },
    });
    const caps = resolveSendCapabilities('lmstudio', 'qwen/qwen3.8-27b', 'lm-studio-v0');
    assert.deepEqual(caps?.reasoningAllowedOptions, ['off', 'low', 'medium', 'high']);
    assert.equal(caps?.reasoningDefault, 'high');
  });
});
