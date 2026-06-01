/**
 * Unit tests for navigation allowlist patterns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNavigationAllowed,
  isNavigationAllowed,
  normalizeAllowlistPatternLine,
} from '../../server/cdp/allowlist.js';

const PATTERNS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'https://localhost:*',
];

test('allows localhost dev origins', () => {
  assert.equal(
    isNavigationAllowed('http://localhost:5173/', PATTERNS),
    true,
  );
  assert.equal(
    isNavigationAllowed('http://127.0.0.1:9222/', PATTERNS),
    true,
  );
});

test('blocks arbitrary external origins', () => {
  assert.equal(
    isNavigationAllowed('https://evil.example/', PATTERNS),
    false,
  );
});

test('assertNavigationAllowed throws with prefix', () => {
  assert.throws(
    () => assertNavigationAllowed('https://evil.example', PATTERNS),
    /navigation blocked by allowlist/,
  );
});

test('allows navigations when pattern is origin-only and url has path', () => {
  const patterns = ['https://example.com'];
  assert.equal(
    isNavigationAllowed('https://example.com/docs/page', patterns),
    true,
  );
});

test('normalizes path-shaped allowlist lines to origin', () => {
  assert.equal(
    normalizeAllowlistPatternLine('https://example.com/foo/bar'),
    'https://example.com',
  );
  const patterns = ['https://example.com/foo'];
  assert.equal(isNavigationAllowed('https://example.com/other', patterns), true);
});
