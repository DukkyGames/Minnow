/**
 * Fallback chain resolver and error classification tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCandidateRequestBody,
  candidateKey,
  classifyUpstreamError,
  computeRetryDelayMs,
  parseRetryAfterMs,
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

  test('appends global fallback after role chain when role chain is empty', () => {
    const chain = resolveFallbackChain({
      role: 'main-chat',
      primaryProviderId: 'primary',
      primaryModelId: 'model-a',
      config: {
        fallbackChains: {
          enabled: true,
          maxChainLength: 4,
          roles: {
            _global: [{ providerId: 'cloud', modelId: 'gpt-4o-mini' }],
          },
        },
      },
      enabledProviderIds: new Set(['primary', 'cloud']),
    });
    assert.deepEqual(chain, [
      { providerId: 'primary', modelId: 'model-a' },
      { providerId: 'cloud', modelId: 'gpt-4o-mini' },
    ]);
  });

  test('appends global fallback after per-role chain', () => {
    const chain = resolveFallbackChain({
      role: 'main-chat',
      primaryProviderId: 'primary',
      primaryModelId: 'model-a',
      config: {
        fallbackChains: {
          enabled: true,
          maxChainLength: 4,
          roles: {
            'main-chat': [{ providerId: 'backup', modelId: '' }],
            _global: [{ providerId: 'cloud', modelId: 'gpt-4o-mini' }],
          },
        },
      },
      enabledProviderIds: new Set(['primary', 'backup', 'cloud']),
    });
    assert.deepEqual(chain, [
      { providerId: 'primary', modelId: 'model-a' },
      { providerId: 'backup', modelId: 'model-a' },
      { providerId: 'cloud', modelId: 'gpt-4o-mini' },
    ]);
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

  test('rate limit and overload statuses are retryable, not fatal', () => {
    for (const status of [408, 425, 429, 529]) {
      const classified = classifyUpstreamError(null, { status });
      assert.equal(classified.kind, 'retryable', `HTTP ${status}`);
      assert.equal(classified.rateLimited, true, `HTTP ${status}`);
    }
  });

  test('502/503/504 are retryable but not rate limits', () => {
    for (const status of [502, 503, 504]) {
      const classified = classifyUpstreamError(null, { status });
      assert.equal(classified.kind, 'retryable');
      assert.notEqual(classified.rateLimited, true);
    }
  });

  test('Retry-After seconds are carried on the classification', () => {
    const classified = classifyUpstreamError(null, {
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    });
    assert.equal(classified.retryAfterMs, 12_000);
  });

  test('Retry-After survives a plain header object', () => {
    const classified = classifyUpstreamError(null, {
      status: 429,
      headers: { 'retry-after': '3' },
    });
    assert.equal(classified.retryAfterMs, 3_000);
  });

  test('a 429 without Retry-After leaves the delay to backoff', () => {
    const classified = classifyUpstreamError(null, { status: 429 });
    assert.equal(classified.retryAfterMs, undefined);
  });
});

describe('parseRetryAfterMs', () => {
  test('parses delta-seconds', () => {
    assert.equal(parseRetryAfterMs('5'), 5_000);
    assert.equal(parseRetryAfterMs(' 0 '), 0);
  });

  test('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const at = new Date(now + 8_000).toUTCString();
    assert.equal(parseRetryAfterMs(at, now), 8_000);
  });

  test('a past HTTP-date clamps to zero', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const at = new Date(now - 60_000).toUTCString();
    assert.equal(parseRetryAfterMs(at, now), 0);
  });

  test('an absurd wait is capped so a turn cannot stall indefinitely', () => {
    assert.equal(parseRetryAfterMs('86400'), 30_000);
  });

  test('missing or unparseable values yield null', () => {
    assert.equal(parseRetryAfterMs(undefined), null);
    assert.equal(parseRetryAfterMs(''), null);
    assert.equal(parseRetryAfterMs('soon'), null);
    assert.equal(parseRetryAfterMs('-4'), null);
  });
});

describe('computeRetryDelayMs', () => {
  test('honours Retry-After over backoff', () => {
    assert.equal(computeRetryDelayMs(1, 7_000), 7_000);
    assert.equal(computeRetryDelayMs(3, 250), 250);
  });

  test('backs off exponentially with jitter when no Retry-After', () => {
    const first = computeRetryDelayMs(1);
    const second = computeRetryDelayMs(2);
    assert.ok(first >= 1_000 && first <= 2_000, `first=${first}`);
    assert.ok(second >= 2_000 && second <= 3_000, `second=${second}`);
  });

  test('never exceeds the cap', () => {
    assert.equal(computeRetryDelayMs(20, 10 ** 9), 30_000);
    assert.ok(computeRetryDelayMs(20) <= 30_000);
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
