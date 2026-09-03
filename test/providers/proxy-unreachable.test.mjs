import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUpstreamCatalogUnreachable } from '../../server/providers/proxy.js';

describe('isUpstreamCatalogUnreachable', () => {
  it('treats fetch failed and connection refused as unreachable', () => {
    assert.equal(isUpstreamCatalogUnreachable(new TypeError('fetch failed')), true);
    const refused = new Error('connect');
    refused.cause = { code: 'ECONNREFUSED' };
    assert.equal(isUpstreamCatalogUnreachable(refused), true);
  });

  it('does not treat a live upstream HTTP error as unreachable', () => {
    assert.equal(
      isUpstreamCatalogUnreachable(new Error('Upstream models HTTP 500: boom')),
      false,
    );
  });
});
