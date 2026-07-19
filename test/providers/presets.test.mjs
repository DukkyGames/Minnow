/**
 * Shared provider preset catalog (onboarding + Settings).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getDefaultPaths } from '../../src/providers/paths.ts';
import {
  ONBOARDING_CLOUD_PRESETS,
  PROVIDER_PRESETS,
  SETTINGS_FEATURED_PRESET_IDS,
  SETTINGS_LOCAL_PRESETS,
  getProviderPreset,
  listSettingsFeaturedPresets,
  listSettingsLocalPresets,
  listSettingsMorePresets,
  listSettingsProviderPresets,
} from '../../src/providers/presets.ts';

describe('provider presets catalog', () => {
  test('MIN-418 featured presets exist with base URLs and auth hints', () => {
    for (const id of SETTINGS_FEATURED_PRESET_IDS) {
      const preset = getProviderPreset(id);
      assert.ok(preset, `missing featured preset: ${id}`);
      assert.ok(preset.baseUrl.startsWith('https://'), `${id} baseUrl must be https`);
      assert.ok(preset.authHint, `${id} should include an auth hint`);
    }
  });

  test('onboarding cloud presets include custom chip and all catalog entries', () => {
    assert.equal(ONBOARDING_CLOUD_PRESETS.length, PROVIDER_PRESETS.length + 1);
    assert.ok(ONBOARDING_CLOUD_PRESETS.some((preset) => preset.id === 'custom'));
    assert.ok(ONBOARDING_CLOUD_PRESETS.some((preset) => preset.id === 'deepseek'));
    assert.ok(ONBOARDING_CLOUD_PRESETS.some((preset) => preset.id === 'github-copilot'));
  });

  test('settings preset list leads with featured presets', () => {
    const listed = listSettingsProviderPresets();
    assert.deepEqual(
      listed.slice(0, SETTINGS_FEATURED_PRESET_IDS.length).map((preset) => preset.id),
      SETTINGS_FEATURED_PRESET_IDS,
    );
    assert.equal(listed.length, PROVIDER_PRESETS.length);
  });

  test('settings picker groups local, featured, and more presets', () => {
    const local = listSettingsLocalPresets();
    assert.equal(local.length, SETTINGS_LOCAL_PRESETS.length);
    assert.ok(local.some((preset) => preset.id === 'lm-studio'));
    assert.ok(local.some((preset) => preset.id === 'ollama'));

    const featured = listSettingsFeaturedPresets();
    assert.equal(featured.length, SETTINGS_FEATURED_PRESET_IDS.length);

    const more = listSettingsMorePresets();
    assert.equal(more.length, PROVIDER_PRESETS.length - SETTINGS_FEATURED_PRESET_IDS.length);
    assert.ok(!more.some((preset) => SETTINGS_FEATURED_PRESET_IDS.includes(preset.id)));
  });

  test('openai-v1 preset baseUrls do not double /v1 when joined with default models path', () => {
    const { modelsPath } = getDefaultPaths('openai-v1');
    assert.equal(modelsPath, '/v1/models');

    for (const preset of PROVIDER_PRESETS) {
      if (preset.apiKind === 'anthropic-v1') continue;
      const url = `${preset.baseUrl}${modelsPath}`;
      assert.equal(url.includes('/v1/v1/'), false, `unexpected double /v1 in ${url}`);
      assert.match(url, /\/v1\/models$/);
    }
  });
});
