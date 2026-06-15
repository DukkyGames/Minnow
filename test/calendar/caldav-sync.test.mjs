/**
 * CalDAV SSRF validation tests (mocked — no live server required).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { resetSsrfCachesForTests } from '../../server/webhooks/ssrf.js';
import { validateCaldavUrl } from '../../server/calendar/caldav-ssrf.js';

after(() => {
  resetSsrfCachesForTests();
});

describe('caldav ssrf validation', () => {
  test('rejects private IP URLs', async () => {
    await assert.rejects(
      () => validateCaldavUrl('https://192.168.1.10/caldav/'),
      /private\/internal/,
    );
  });

  test('rejects localhost hostnames', async () => {
    await assert.rejects(
      () => validateCaldavUrl('https://localhost/caldav/'),
      /private\/internal/,
    );
  });

  test('accepts public https URLs when host resolves publicly', async () => {
    const url = await validateCaldavUrl('https://example.com/caldav/');
    assert.equal(url, 'https://example.com/caldav');
  });

  test('allows local http when explicitly enabled', async () => {
    const url = await validateCaldavUrl('http://127.0.0.1:5232/', { allowLocalHttp: true });
    assert.equal(url, 'http://127.0.0.1:5232');
  });
});
