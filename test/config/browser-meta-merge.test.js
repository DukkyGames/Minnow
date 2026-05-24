/**
 * mergeConfigMeta browser block.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfigMeta } from '../../server/config/validators.js';

test('mergeConfigMeta merges browser allowedOriginPatterns', () => {
  const merged = mergeConfigMeta(
    {},
    {
      browser: {
        allowedOriginPatterns: ['https://example.com', 'https://*.test.dev'],
      },
    },
  );
  const browser = /** @type {{ allowedOriginPatterns: string[] }} */ (merged.browser);
  assert.deepEqual(browser.allowedOriginPatterns, [
    'https://example.com',
    'https://*.test.dev',
  ]);
});

test('mergeConfigMeta preserves existing browser fields when patching allowNavigate', () => {
  const merged = mergeConfigMeta(
    {
      browser: {
        enabled: true,
        defaultUrl: 'http://127.0.0.1:9222',
        allowNavigate: true,
        allowedOriginPatterns: ['http://localhost:*'],
        screenshotDir: 'screenshots',
      },
    },
    { browser: { allowNavigate: false } },
  );
  const browser = /** @type {{ allowNavigate: boolean; allowedOriginPatterns: string[] }} */ (
    merged.browser
  );
  assert.equal(browser.allowNavigate, false);
  assert.deepEqual(browser.allowedOriginPatterns, ['http://localhost:*']);
});
