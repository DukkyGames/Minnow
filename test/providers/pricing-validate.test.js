/**
 * Provider pricing validation (server).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateProviderPricing } from '../../server/providers/validate.js';

describe('validateProviderPricing', () => {
  test('accepts default and per-model rates', () => {
    const out = validateProviderPricing({
      currency: 'usd',
      default: { inputPer1M: 1, outputPer1M: 2 },
      models: { 'gpt-4o': { inputPer1M: 5, outputPer1M: 15 } },
    });
    assert.equal(out.currency, 'USD');
    assert.equal(out.default.inputPer1M, 1);
    assert.equal(out.models['gpt-4o'].outputPer1M, 15);
  });

  test('null clears pricing', () => {
    assert.equal(validateProviderPricing(null), null);
  });

  test('rejects negative rates', () => {
    assert.throws(() => validateProviderPricing({ default: { inputPer1M: -1, outputPer1M: 1 } }));
  });
});
