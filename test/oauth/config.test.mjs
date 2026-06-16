/**
 * OAuth config normalization tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeOAuthConfig } from '../../server/config/validators.js';

describe('normalizeOAuthConfig', () => {
  test('merges google and microsoft credentials', () => {
    const result = normalizeOAuthConfig(
      {
        google: { clientId: ' g-id ', clientSecret: 'g-secret' },
        microsoft: { clientId: 'm-id', clientSecret: 'm-secret', tenantId: ' tenants ' },
      },
      {},
    );
    assert.equal(result.google.clientId, 'g-id');
    assert.equal(result.google.clientSecret, 'g-secret');
    assert.equal(result.microsoft.clientId, 'm-id');
    assert.equal(result.microsoft.clientSecret, 'm-secret');
    assert.equal(result.microsoft.tenantId, 'tenants');
  });

  test('preserves existing secret when patch omits it', () => {
    const result = normalizeOAuthConfig(
      { google: { clientId: 'new-id' } },
      { google: { clientId: 'old-id', clientSecret: 'keep-me' } },
    );
    assert.equal(result.google.clientId, 'new-id');
    assert.equal(result.google.clientSecret, 'keep-me');
  });
});
