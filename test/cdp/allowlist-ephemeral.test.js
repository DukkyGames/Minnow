/**
 * Ephemeral navigation grants and pattern suggestions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNavigationAllowed,
  grantEphemeralNavigation,
  isNavigationAllowed,
  resetEphemeralNavigation,
  suggestAllowlistPattern,
} from '../../server/cdp/allowlist.js';

const PATTERNS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'https://localhost:*',
];

test('suggestAllowlistPattern uses host wildcard when port present', () => {
  assert.equal(
    suggestAllowlistPattern('http://localhost:5173/app'),
    'http://localhost:*',
  );
  assert.equal(
    suggestAllowlistPattern('https://example.com/page'),
    'https://example.com',
  );
});

test('ephemeral grant allows one external navigation check', () => {
  resetEphemeralNavigation();
  const url = 'https://example.com/path';
  assert.equal(isNavigationAllowed(url, PATTERNS), false);
  grantEphemeralNavigation('https://example.com');
  assert.equal(isNavigationAllowed(url, PATTERNS), true);
  resetEphemeralNavigation();
  assert.equal(isNavigationAllowed(url, PATTERNS), false);
});

test('assertNavigationAllowed error mentions ask_question flow', () => {
  resetEphemeralNavigation();
  assert.throws(
    () => assertNavigationAllowed('https://evil.example', PATTERNS),
    /ask_question/,
  );
});
