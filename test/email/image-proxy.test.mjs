/**
 * Image proxy URL validation — the guard that keeps "load images" from
 * becoming an SSRF hole into the user's own network.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fetchRemoteImage } from '../../server/email/image-proxy.js';

/** Assert the proxy refuses a URL before any request goes out. */
async function assertRejects(url, pattern) {
  await assert.rejects(() => fetchRemoteImage(url), pattern, `expected ${url} to be refused`);
}

describe('image proxy URL validation', () => {
  test('refuses loopback and link-local addresses', async () => {
    await assertRejects('http://127.0.0.1/pixel.png', /private\/internal/);
    await assertRejects('http://[::1]/pixel.png', /private\/internal/);
    // Cloud metadata endpoints are the classic SSRF prize.
    await assertRejects('http://169.254.169.254/latest/meta-data/', /private\/internal/);
  });

  test('refuses RFC1918 ranges', async () => {
    await assertRejects('http://10.0.0.5/a.png', /private\/internal/);
    await assertRejects('http://192.168.1.1/a.png', /private\/internal/);
    await assertRejects('http://172.16.0.9/a.png', /private\/internal/);
  });

  test('refuses non-http schemes', async () => {
    await assertRejects('file:///etc/passwd', /must use http/);
    await assertRejects('ftp://example.com/a.png', /must use http/);
    // A javascript: URL should never reach the network stack at all.
    await assertRejects('javascript:alert(1)', /must use http/);
  });

  test('refuses malformed and empty input', async () => {
    await assertRejects('', /url is required/);
    await assertRejects('not-a-url', /absolute http/);
    await assertRejects(`https://example.com/${'a'.repeat(2100)}`, /too long/);
  });

  test('refuses hosts that do not resolve', async () => {
    await assertRejects(
      'https://this-host-should-not-exist.invalid/a.png',
      /does not resolve|private\/internal/,
    );
  });
});
