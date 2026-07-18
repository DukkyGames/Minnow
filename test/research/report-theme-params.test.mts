/**
 * Client-side research report theme query param encoding.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCustomTokensParam } from '../../server/research/report-theme.js';
import { encodeCustomTokensPayload } from '../../src/research/report-theme-params.ts';

describe('research report theme params', () => {
  it('encodeCustomTokensPayload round-trips through parseCustomTokensParam', () => {
    const tokens = {
      bg: '#101820',
      fg: '#f0f4f8',
      accent: '#3dd6c6',
      'surface-0': '#0b1016',
      'accent-soft': 'rgba(61,214,198,0.14)',
    };
    const encoded = encodeCustomTokensPayload(tokens);
    assert.ok(encoded);
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.deepEqual(parseCustomTokensParam(encoded), tokens);
  });
});
