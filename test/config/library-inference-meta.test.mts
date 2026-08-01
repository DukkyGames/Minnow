/**
 * Client merge of global sampler with per-library-model overrides.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  mergeGlobalSamplerWithLibraryModel,
  setLibraryInferencePrefsForTests,
} from '../../src/config/library-inference-meta.ts';

describe('mergeGlobalSamplerWithLibraryModel', () => {
  test('applies alias lookup over global preset', () => {
    setLibraryInferencePrefsForTests({
      byLibraryId: {
        'gguf:qwen:file.gguf': { temperature: 0.25, topP: 0.8, maxTokens: 4096 },
      },
      chatModelAliases: { 'local-qwen': 'gguf:qwen:file.gguf' },
    });

    const merged = mergeGlobalSamplerWithLibraryModel(
      {
        maxTokens: 32768,
        preset: { temperature: 1.0, topP: 0.95, topK: 20 },
      },
      'local-qwen',
    );

    assert.equal(merged.preset.temperature, 0.25);
    assert.equal(merged.preset.topP, 0.8);
    assert.equal(merged.preset.topK, 20);
    assert.equal(merged.maxTokens, 4096);
  });

  test('returns global when no alias matches', () => {
    setLibraryInferencePrefsForTests({
      byLibraryId: { 'gguf:a': { temperature: 0.1 } },
      chatModelAliases: {},
    });

    const global = {
      maxTokens: 1000,
      preset: { temperature: 1.0 },
    };
    assert.deepEqual(mergeGlobalSamplerWithLibraryModel(global, 'other-model'), global);
  });
});
