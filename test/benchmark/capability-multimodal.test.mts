/**
 * BUG-004: cap-multimodal vision detection and probe scoring.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { modelCache } from '../../src/app-state.ts';
import { defaultSessionState } from '../../src/config/defaults.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  buildMultimodalProbeMessages,
  MULTIMODAL_PROBE_IMAGE_DATA_URL,
} from '../../src/benchmark/fixtures/multimodal-probe.ts';
import { scoreMultimodalProbe } from '../../src/benchmark/suites/cap-multimodal.ts';
import { isVisionModel } from '../../src/providers/vision-model.ts';
import type { LmModelRecord } from '../../src/types.ts';

const VLM_NO_REGEX_ID = 'vendor/custom-model-q4';

describe('isVisionModel (BUG-004)', () => {
  beforeEach(() => {
    modelCache.clear();
    setSessionStateForTests(defaultSessionState());
  });

  afterEach(() => {
    modelCache.clear();
    setSessionStateForTests(defaultSessionState());
  });

  test('cached type vlm without regex tokens in id', () => {
    modelCache.set(VLM_NO_REGEX_ID, { id: VLM_NO_REGEX_ID, type: 'vlm' });
    assert.equal(isVisionModel(VLM_NO_REGEX_ID), true);
  });

  test('cached type llm is not vision', () => {
    modelCache.set('text-only-7b', { id: 'text-only-7b', type: 'llm' });
    assert.equal(isVisionModel('text-only-7b'), false);
  });

  test('capabilities.vision true overrides type llm', () => {
    modelCache.set('probed-vision', {
      id: 'probed-vision',
      type: 'llm',
      capabilities: { vision: true, tools: null, streaming: null, grammar: null, reasoning: null, contextLength: null, loadState: null },
    });
    assert.equal(isVisionModel('probed-vision'), true);
  });

  test('catalogVision true on llm row is vision', () => {
    modelCache.set('catalog-vision-llm', {
      id: 'catalog-vision-llm',
      type: 'llm',
      catalogVision: true,
    });
    assert.equal(isVisionModel('catalog-vision-llm'), true);
  });

  test('catalog fallback finds vlm row when cache is cold', () => {
    const catalog: LmModelRecord[] = [{ id: VLM_NO_REGEX_ID, type: 'vlm' }];
    assert.equal(isVisionModel(VLM_NO_REGEX_ID, catalog), true);
  });

  test('catalog llm row skips vision without cache', () => {
    const catalog: LmModelRecord[] = [{ id: 'plain-llm', type: 'llm' }];
    assert.equal(isVisionModel('plain-llm', catalog), false);
  });

  test('catalog id regex fallback when row missing', () => {
    assert.equal(isVisionModel('my-llava-7b', []), true);
  });

  test('no catalog and cache miss is not vision', () => {
    assert.equal(isVisionModel('unknown-model'), false);
  });

  test('lm-studio llm row stays text-only (its catalog names VLMs)', () => {
    modelCache.set('lms-vl-row', {
      id: 'lms-vl-row',
      type: 'llm',
      api: 'lm-studio-v0',
      capabilities: {
        vision: false,
        tools: null,
        streaming: null,
        grammar: null,
        reasoning: null,
        contextLength: null,
        loadState: null,
        sources: { vision: 'catalog' },
      },
    });
    assert.equal(isVisionModel('lms-vl-row'), false);
  });

  test('openai-v1 llm row falls back to the id heuristic (MTPLX, llama.cpp)', () => {
    // These catalogs list bare `{ id }` rows; `llm` is stamped on by the
    // normalizer and is not evidence that the model cannot read images.
    modelCache.set('Qwen3-VL-8B-Instruct', {
      id: 'Qwen3-VL-8B-Instruct',
      type: 'llm',
      api: 'openai-v1',
      capabilities: {
        vision: false,
        tools: null,
        streaming: null,
        grammar: null,
        reasoning: null,
        contextLength: null,
        loadState: null,
        sources: { vision: 'catalog' },
      },
    });
    assert.equal(isVisionModel('Qwen3-VL-8B-Instruct'), true);
  });

  test('a probed vision:false is decisive over the id heuristic', () => {
    modelCache.set('Qwen3-VL-8B-Instruct', {
      id: 'Qwen3-VL-8B-Instruct',
      type: 'llm',
      api: 'openai-v1',
      capabilities: {
        vision: false,
        tools: null,
        streaming: null,
        grammar: null,
        reasoning: null,
        contextLength: null,
        loadState: null,
        sources: { vision: 'probe' },
      },
    });
    assert.equal(isVisionModel('Qwen3-VL-8B-Instruct'), false);
  });

  test('id heuristic does not fire on plain text model ids', () => {
    for (const id of ['Qwen3-8B-Instruct', 'vllm-served-7b', 'devstral-small']) {
      assert.equal(isVisionModel(id), false, id);
    }
  });
});

describe('scoreMultimodalProbe (BUG-004)', () => {
  test('non-empty response passes with snippet details', () => {
    const scored = scoreMultimodalProbe('red');
    assert.equal(scored.passed, true);
    assert.equal(scored.details, 'red');
  });

  test('empty text fails with empty vision response', () => {
    const scored = scoreMultimodalProbe('');
    assert.equal(scored.passed, false);
    assert.equal(scored.details, 'empty vision response');
  });

  test('error message fails with error details', () => {
    const scored = scoreMultimodalProbe('', 'Provider rejected image_url');
    assert.equal(scored.passed, false);
    assert.equal(scored.details, 'Provider rejected image_url');
  });
});

describe('multimodal probe fixture', () => {
  test('buildMultimodalProbeMessages includes image_url part', () => {
    const messages = buildMultimodalProbeMessages();
    const user = messages.find((m) => m.role === 'user');
    assert.ok(user && Array.isArray(user.content));
    const parts = user.content;
    assert.ok(parts.some((p) => p.type === 'image_url'));
    const imagePart = parts.find((p) => p.type === 'image_url');
    assert.ok(imagePart && imagePart.type === 'image_url');
    assert.equal(imagePart.image_url.url, MULTIMODAL_PROBE_IMAGE_DATA_URL);
    assert.equal(imagePart.image_url.detail, 'low');
  });
});
