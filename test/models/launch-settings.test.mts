/**
 * Shared llama.cpp launch drafts — inspector slider must reach every GGUF load path.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { DEFAULT_CONTEXT_TOKENS } from '../../src/models/default-context-tokens.ts';
import {
  CONTEXT_SLIDER_MAX,
  CONTEXT_SLIDER_MIN,
  CONTEXT_SLIDER_STEP,
  clampContextSlider,
  clearLaunchSettingsForTests,
  contextSliderMax,
  contextSliderValueIsValid,
  getLaunchSettings,
  patchLaunchSettings,
  resolveLlamaServeSettings,
} from '../../src/models/launch-settings.ts';
import type { LibraryModel } from '../../src/models/library.ts';

function ggufModel(id = 'gguf:org/demo:weights.gguf'): Pick<LibraryModel, 'id' | 'source' | 'format'> {
  return { id, source: 'downloaded', format: 'GGUF' };
}

describe('launch settings', () => {
  afterEach(() => {
    clearLaunchSettingsForTests();
  });

  test('default and 2048 are valid HTML range values', () => {
    assert.equal(CONTEXT_SLIDER_STEP, 1);
    assert.ok(contextSliderValueIsValid(CONTEXT_SLIDER_MIN));
    assert.ok(contextSliderValueIsValid(DEFAULT_CONTEXT_TOKENS));
    assert.ok(contextSliderValueIsValid(CONTEXT_SLIDER_MAX));
  });

  test('clampContextSlider keeps 2048 and the 125k default on the grid', () => {
    assert.equal(clampContextSlider(2048), 2048);
    assert.equal(clampContextSlider(DEFAULT_CONTEXT_TOKENS), DEFAULT_CONTEXT_TOKENS);
    assert.equal(clampContextSlider(1000), CONTEXT_SLIDER_MIN);
    assert.equal(clampContextSlider(Number.NaN), CONTEXT_SLIDER_MIN);
    assert.equal(clampContextSlider(999_999), CONTEXT_SLIDER_MAX);
  });

  test('contextSliderMax caps at trained context when known', () => {
    assert.equal(contextSliderMax(8192), 8192);
    assert.equal(contextSliderMax(262_144), 262_144);
    assert.equal(contextSliderMax(null), CONTEXT_SLIDER_MAX);
  });

  test('resolveLlamaServeSettings uses the inspector draft when the caller omits settings', () => {
    const model = ggufModel();
    patchLaunchSettings(model.id, { ctx: 2048 });
    const resolved = resolveLlamaServeSettings(model);
    assert.equal(resolved?.ctx, 2048);
  });

  test('explicit settings win over the draft', () => {
    const model = ggufModel();
    patchLaunchSettings(model.id, { ctx: 2048 });
    const resolved = resolveLlamaServeSettings(model, { ctx: 4096 });
    assert.equal(resolved?.ctx, 4096);
  });

  test('MLX and Ollama do not send llama.cpp argv', () => {
    assert.equal(
      resolveLlamaServeSettings({ id: 'mlx:org/demo', source: 'downloaded', format: 'MLX' }),
      undefined,
    );
    assert.equal(
      resolveLlamaServeSettings({ id: 'ollama:demo', source: 'ollama', format: 'Ollama' }),
      undefined,
    );
  });

  test('getLaunchSettings returns the same object the inspector mutates', () => {
    const a = getLaunchSettings('gguf:a');
    a.ctx = 2048;
    assert.equal(getLaunchSettings('gguf:a').ctx, 2048);
  });
});
