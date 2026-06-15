/**
 * SSRF guard tests for outgoing webhooks (ported from Odysseus).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isPrivateIpAddress,
  resetSsrfCachesForTests,
  sanitizeError,
  validateWebhookUrl,
} from '../../server/webhooks/ssrf.js';

describe('validateWebhookUrl', () => {
  test('rejects private IPv4 literals', async () => {
    const privateUrls = [
      'https://127.0.0.1/hook',
      'https://10.0.0.1/hook',
      'https://192.168.0.1/hook',
      'https://169.254.169.254/hook',
      'https://0.0.0.0/hook',
    ];
    for (const url of privateUrls) {
      await assert.rejects(
        () => validateWebhookUrl(url),
        /private\/internal addresses/,
      );
    }
  });

  test('rejects localhost hostnames', async () => {
    await assert.rejects(
      () => validateWebhookUrl('https://localhost/hook'),
      /private\/internal addresses/,
    );
  });

  test('accepts public HTTPS IP literal', async () => {
    const url = 'https://93.184.216.34/hook';
    assert.equal(await validateWebhookUrl(url), url);
  });

  test('allows local http only when flag is set', async () => {
    await assert.rejects(
      () => validateWebhookUrl('http://127.0.0.1/hook'),
      /https/,
    );
    const url = 'http://127.0.0.1/hook';
    assert.equal(await validateWebhookUrl(url, { allowLocalHttp: true }), url);
  });
});

describe('isPrivateIpAddress', () => {
  test('flags IPv4-mapped loopback', () => {
    resetSsrfCachesForTests();
    assert.equal(isPrivateIpAddress('::ffff:127.0.0.1'), true);
  });
});

describe('sanitizeError', () => {
  test('redacts IPv6 and URLs', () => {
    const out = sanitizeError('POST https://[2001:db8::1]:443/hook failed for fe80::1');
    assert.match(out, /\[redacted/);
    assert.doesNotMatch(out, /2001:db8/);
    assert.doesNotMatch(out, /fe80::/);
  });

  test('preserves non-address colons', () => {
    const msg = 'failed at 12:34:56 today';
    assert.equal(sanitizeError(msg), msg);
  });

  test('redacts IPv4-mapped IPv6 as one unit', () => {
    assert.equal(
      sanitizeError('to ::ffff:192.168.0.1 closed'),
      'to [redacted] closed',
    );
  });
});
