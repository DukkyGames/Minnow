import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { checkBrowserNavigationAllowed } from '../../src/config/browser-meta.ts';
import { formatBrowserAllowlistCheckFailure } from '../../src/tools/browser-navigation-gate.ts';

describe('checkBrowserNavigationAllowed', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('maps 401 to auth failure', async () => {
    globalThis.fetch = (async () =>
      new Response('{}', { status: 401 })) as typeof fetch;
    const result = await checkBrowserNavigationAllowed('https://example.com');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.reason, 'auth');
    assert.match(formatBrowserAllowlistCheckFailure(result), /session/i);
  });

  test('maps invalid url 400 to invalid failure', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const result = await checkBrowserNavigationAllowed('not-a-url');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.reason, 'invalid');
    assert.match(formatBrowserAllowlistCheckFailure(result), /Invalid URL/i);
  });

  test('maps network errors to network failure', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const result = await checkBrowserNavigationAllowed('https://example.com');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.reason, 'network');
  });
});
