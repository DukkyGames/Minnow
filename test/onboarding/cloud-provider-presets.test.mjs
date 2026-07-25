/**
 * Onboarding cloud preset id helpers — configured-provider confirmation chips.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  ONBOARDING_CLOUD_PROVIDER_PREFIX,
  listConfiguredOnboardingCloudPresetIds,
  onboardingCloudProviderId,
  presetIdFromOnboardingCloudProviderId,
} = await import('../../src/onboarding/state-core.ts');

describe('onboarding cloud provider preset ids', () => {
  test('onboardingCloudProviderId uses stable onboarding prefix', () => {
    assert.equal(onboardingCloudProviderId('openrouter'), `${ONBOARDING_CLOUD_PROVIDER_PREFIX}openrouter`);
  });

  test('presetIdFromOnboardingCloudProviderId round-trips preset ids', () => {
    assert.equal(
      presetIdFromOnboardingCloudProviderId('onboarding-cloud-groq'),
      'groq',
    );
    assert.equal(presetIdFromOnboardingCloudProviderId('openrouter'), null);
  });

  test('listConfiguredOnboardingCloudPresetIds returns presets with saved keys only', () => {
    const configured = listConfiguredOnboardingCloudPresetIds([
      { id: 'onboarding-cloud-openrouter', hasApiKey: true },
      { id: 'onboarding-cloud-groq', hasApiKey: false },
      { id: 'lm-studio-local', hasApiKey: true },
      { id: 'onboarding-cloud-custom', hasApiKey: true },
    ]);
    assert.deepEqual(configured.sort(), ['custom', 'openrouter']);
  });
});
