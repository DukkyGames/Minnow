/**
 * Provider host locality helpers (local loopback vs remote cloud APIs).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('provider-host', () => {
  test('isLocalProviderHostname recognizes loopback hosts', async () => {
    const { isLocalProviderHostname } = await import('../../src/providers/provider-host.ts');
    assert.equal(isLocalProviderHostname('localhost'), true);
    assert.equal(isLocalProviderHostname('127.0.0.1'), true);
    assert.equal(isLocalProviderHostname('::1'), true);
    assert.equal(isLocalProviderHostname('api.openai.com'), false);
  });

  test('isLocalProviderBaseUrl parses provider URLs', async () => {
    const { isLocalProviderBaseUrl } = await import('../../src/providers/provider-host.ts');
    assert.equal(isLocalProviderBaseUrl('http://localhost:1234'), true);
    assert.equal(isLocalProviderBaseUrl('http://127.0.0.1:11434/v1'), true);
    assert.equal(isLocalProviderBaseUrl('https://api.anthropic.com'), false);
  });

  test('isKnownLocalProviderId recognizes built-in local provider ids', async () => {
    const { isKnownLocalProviderId } = await import('../../src/providers/provider-host.ts');
    assert.equal(isKnownLocalProviderId('lm-studio-local'), true);
    assert.equal(isKnownLocalProviderId('vite-fallback'), true);
    assert.equal(isKnownLocalProviderId('openrouter'), false);
  });
});
