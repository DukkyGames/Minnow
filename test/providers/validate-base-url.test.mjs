/**
 * Provider baseUrl validation preserves gateway path prefixes.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateBaseUrl } from '../../server/providers/validate.js';

describe('validateBaseUrl', () => {
  test('keeps origin-only URLs unchanged', () => {
    assert.equal(validateBaseUrl('https://opencode.ai'), 'https://opencode.ai');
    assert.equal(validateBaseUrl('https://opencode.ai/'), 'https://opencode.ai');
    assert.equal(validateBaseUrl('http://localhost:1234'), 'http://localhost:1234');
  });

  test('preserves OpenCode Zen path prefix on baseUrl', () => {
    assert.equal(validateBaseUrl('https://opencode.ai/zen'), 'https://opencode.ai/zen');
    assert.equal(validateBaseUrl('https://opencode.ai/zen/go'), 'https://opencode.ai/zen/go');
    assert.equal(
      validateBaseUrl('https://opencode.ai/zen/v1'),
      'https://opencode.ai/zen/v1',
    );
  });

  test('preserves OpenRouter /api prefix on baseUrl', () => {
    assert.equal(
      validateBaseUrl('https://openrouter.ai/api'),
      'https://openrouter.ai/api',
    );
  });

  test('rejects invalid URLs', () => {
    assert.throws(() => validateBaseUrl(''), /baseUrl is required/);
    assert.throws(() => validateBaseUrl('not-a-url'), /Invalid baseUrl/);
    assert.throws(() => validateBaseUrl('ftp://example.com'), /http or https/);
  });
});
