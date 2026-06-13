/**
 * Fallback chain resolver and error classification tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCandidateRequestBody,
  candidateKey,
  classifyUpstreamError,
  resolveFallbackChain,
} from '../../server/generations/fallback.js';
import {
  defaultFallbackChainsConfig,
  mergeConfigMeta,
  normalizeFallbackChainsConfig,
} from '../../server/config/validators.js';
import { DEFAULT_META } from '../../server/config/home.js';

describe('fallback chain resolver', () => {
  test('disabled fallback returns primary only', () => {
    const chain = resolveFallbackChain({
      role: 'default',
      primaryProviderId: 'primary',
      primaryModelId: 'model-a',
      config: { fallbackChains: { enabled: false } },
    });
    assert.deepEqual(chain, [{ providerId: 'primary', modelId: 'model-a' }]);
  });

  test('enabled fallback dedupes and caps chain length', () => {
    const chain = resolveFallbackChain({
      role: 'default',
      primaryProviderId: 'primary',
      primaryModelId: 'model-a',
      config: {
        fallbackChains: {
          enabled: true,
          maxChainLength: 3,
          roles: {
            default: [
              { providerId: 'primary', modelId: 'model-a' },
              { providerId: 'backup', modelId: '' },
              { providerId: 'backup', modelId: 'override' },
              { providerId: 'cloud', modelId: 'gpt-4o-mini' },
            ],
          },
        },
      },
      enabledProviderIds: new Set(['primary', 'backup', 'cloud']),
    });
    assert.equal(chain.length, 3);
    assert.equal(chain[0].providerId, 'primary');
    assert.equal(chain[1].providerId, 'backup');
    assert.equal(chain[1].modelId, 'model-a');
    assert.equal(chain[2].providerId, 'backup');
    assert.equal(chain[2].modelId, 'override');
  });

  test('skips disabled providers at resolve time', () => {
    const chain = resolveFallbackChain({
      role: 'utility',
      primaryProviderId: 'primary',
      primaryModelId: 'm1',
      config: {
        fallbackChains: {
          enabled: true,
          roles: {
            utility: [
              { providerId: 'disabled-one', modelId: '' },
              { providerId: 'backup', modelId: 'm2' },
            ],
          },
        },
      },
      enabledProviderIds: new Set(['primary', 'backup']),
    });
    assert.deepEqual(chain, [
      { providerId: 'primary', modelId: 'm1' },
      { providerId: 'backup', modelId: 'm2' },
    ]);
  });

  test('candidateKey is stable', () => {
    assert.equal(candidateKey('p', 'm'), 'p:m');
  });

  test('buildCandidateRequestBody overrides model when provided', () => {
    const body = Buffer.from(JSON.stringify({ model: 'old', messages: [] }), 'utf8');
    const next = buildCandidateRequestBody(body, 'new-model');
    const parsed = JSON.parse(next.toString('utf8'));
    assert.equal(parsed.model, 'new-model');
  });
});

describe('classifyUpstreamError', () => {
  test('auth errors are fatal', () => {
    assert.equal(classifyUpstreamError(null, { status: 401 }).kind, 'fatal');
    assert.equal(classifyUpstreamError(null, { status: 403 }).kind, 'fatal');
  });

  test('connection errors are retryable', () => {
    assert.equal(classifyUpstreamError({ code: 'ECONNREFUSED' }).kind, 'retryable');
    assert.equal(classifyUpstreamError({ code: 'ETIMEDOUT' }).kind, 'retryable');
  });

  test('502/503/504 are retryable', () => {
    assert.equal(classifyUpstreamError(null, { status: 503 }).kind, 'retryable');
  });

  test('abort is fatal', () => {
    assert.equal(classifyUpstreamError({ name: 'AbortError' }).kind, 'fatal');
  });
});

describe('fallback config merge', () => {
  test('DEFAULT_META seeds fallbackChains disabled', () => {
    assert.equal(DEFAULT_META.fallbackChains.enabled, false);
    assert.equal(DEFAULT_META.fallbackChains.cooldownSeconds, 60);
  });

  test('normalizeFallbackChainsConfig clamps bounds', () => {
    const normalized = normalizeFallbackChainsConfig({
      enabled: true,
      cooldownSeconds: 3,
      maxChainLength: 20,
    });
    assert.equal(normalized.cooldownSeconds, 10);
    assert.equal(normalized.maxChainLength, 8);
  });

  test('mergeConfigMeta merges fallbackChains roles', () => {
    const merged = mergeConfigMeta({}, {
      fallbackChains: {
        enabled: true,
        roles: {
          default: [{ providerId: 'backup', modelId: '' }],
        },
      },
    });
    assert.equal(merged.fallbackChains.enabled, true);
    assert.deepEqual(merged.fallbackChains.roles.default, [
      { providerId: 'backup', modelId: '' },
    ]);
    assert.deepEqual(merged.fallbackChains.roles.utility, defaultFallbackChainsConfig().roles.utility);
  });
});
