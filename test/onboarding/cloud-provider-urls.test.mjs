/**
 * Onboarding cloud presets must not include /v1 on baseUrl — getDefaultPaths('openai-v1')
 * already uses /v1/models and /v1/chat/completions.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getDefaultPaths } from '../../src/providers/paths.ts';

/** Keep in sync with CLOUD_PRESETS in src/onboarding/steps/provider.ts */
const ONBOARDING_CLOUD_BASE_URLS = [
  'https://openrouter.ai/api',
  'https://api.openai.com',
  'https://api.groq.com/openai',
  'https://api.mistral.ai',
];

describe('onboarding cloud provider URLs', () => {
  test('preset baseUrls do not double /v1 when joined with default models path', () => {
    const { modelsPath } = getDefaultPaths('openai-v1');
    assert.equal(modelsPath, '/v1/models');

    for (const baseUrl of ONBOARDING_CLOUD_BASE_URLS) {
      const url = `${baseUrl}${modelsPath}`;
      assert.equal(url.includes('/v1/v1/'), false, `unexpected double /v1 in ${url}`);
      assert.match(url, /\/v1\/models$/);
    }
  });
});
