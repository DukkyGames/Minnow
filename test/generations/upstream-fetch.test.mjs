/**
 * upstream-fetch: undici must not enforce the default 300s body timeout on LLM streams.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getUpstreamAgentForTests } from '../../server/generations/upstream-fetch.js';

describe('upstream-fetch undici agent', () => {
  test('disables undici body and headers timeouts (Minnow idle/max timers own the stream)', () => {
    const agent = getUpstreamAgentForTests();
    const optionsSymbol = Object.getOwnPropertySymbols(agent).find(
      (symbol) => symbol.description === 'options',
    );
    assert.ok(optionsSymbol);
    const options = agent[optionsSymbol];
    assert.equal(options.bodyTimeout, 0);
    assert.equal(options.headersTimeout, 0);
  });
});
