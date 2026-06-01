/**
 * Client allowlist matcher (mirrors server/cdp/allowlist.js).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isNavigationAllowed,
  normalizeAllowlistPatternLine,
  normalizeAllowlistPatterns,
} from '../../src/tools/browser-allowlist-match.ts';

describe('browser-allowlist-match', () => {
  test('normalizeAllowlistPatterns dedupes case-insensitively', () => {
    const out = normalizeAllowlistPatterns([
      'https://Example.com',
      'HTTPS://example.com',
    ]);
    assert.equal(out.length, 1);
  });

  test('isNavigationAllowed matches localhost port wildcard', () => {
    const patterns = ['http://localhost:*'];
    assert.equal(isNavigationAllowed('http://localhost:5173/app', patterns), true);
  });
});
