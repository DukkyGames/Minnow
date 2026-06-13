import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import {
  defaultFallbackChainsConfig,
  mergeConfigMeta,
  normalizeFallbackChainsConfig,
} from '../../server/config/validators.js';

describe('fallbackChains config defaults', () => {
  test('DEFAULT_META includes disabled fallbackChains block', () => {
    assert.deepEqual(DEFAULT_META.fallbackChains.roles.default, []);
    assert.equal(DEFAULT_META.fallbackChains.enabled, false);
  });

  test('invalid candidate rows are rejected during normalize', () => {
    const normalized = normalizeFallbackChainsConfig({
      roles: {
        default: [{ providerId: '' }, { providerId: 'ok', modelId: 'm' }, null],
      },
    });
    assert.deepEqual(normalized.roles.default, [{ providerId: 'ok', modelId: 'm' }]);
  });

  test('mergeConfigMeta keeps existing roles when patch omits them', () => {
    const merged = mergeConfigMeta(
      {
        fallbackChains: {
          ...defaultFallbackChainsConfig(),
          roles: {
            ...defaultFallbackChainsConfig().roles,
            utility: [{ providerId: 'cloud', modelId: 'mini' }],
          },
        },
      },
      {
        fallbackChains: {
          enabled: true,
        },
      },
    );
    assert.equal(merged.fallbackChains.enabled, true);
    assert.deepEqual(merged.fallbackChains.roles.utility, [
      { providerId: 'cloud', modelId: 'mini' },
    ]);
  });
});
