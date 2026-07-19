/**
 * Onboarding cloud presets must not include /v1 on baseUrl — getDefaultPaths('openai-v1')
 * already uses /v1/models and /v1/chat/completions.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getDefaultPaths } from '../../src/providers/paths.ts';
import { ONBOARDING_CLOUD_PRESETS } from '../../src/providers/presets.ts';

describe('onboarding cloud provider URLs', () => {
  test('preset baseUrls do not double /v1 when joined with default models path', () => {
    const { modelsPath } = getDefaultPaths('openai-v1');
    assert.equal(modelsPath, '/v1/models');

    const baseUrls = ONBOARDING_CLOUD_PRESETS.filter((preset) => preset.baseUrl).map(
      (preset) => preset.baseUrl,
    );

    for (const baseUrl of baseUrls) {
      const url = `${baseUrl}${modelsPath}`;
      assert.equal(url.includes('/v1/v1/'), false, `unexpected double /v1 in ${url}`);
      assert.match(url, /\/v1\/models$/);
    }
  });
});
