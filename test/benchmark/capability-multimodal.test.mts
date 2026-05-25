/**
 * BUG-004: cap-multimodal vision detection and probe scoring.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { modelCache } from '../../src/app-state.ts';
import {
  buildMultimodalProbeMessages,
  MULTIMODAL_PROBE_IMAGE_DATA_URL,
} from '../../src/benchmark/fixtures/multimodal-probe.ts';
import { scoreMultimodalProbe } from '../../src/benchmark/suites/cap-multimodal.ts';
import { isVisionModel } from '../../src/providers/vision-model.ts';
import type { LmModelRecord } from '../../src/types.ts';

const VLM_NO_REGEX_ID = 'vendor/custom-model-q4';

describe('isVisionModel (BUG-004)', () => {
  afterEach(() => {
    modelCache.clear();
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
