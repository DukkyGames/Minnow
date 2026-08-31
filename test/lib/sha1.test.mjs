/**
 * SHA-1 must match Node crypto so client repo keys agree with the server.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { sha1Hex } from '../../src/lib/sha1.mjs';

describe('sha1Hex', () => {
  it('matches Node crypto for ascii, unicode, and empty strings', () => {
    for (const text of ['', 'abc', '/repos/Minnow', 'café', '𝄞']) {
      const expected = createHash('sha1').update(text, 'utf8').digest('hex');
      assert.equal(sha1Hex(text), expected, text);
    }
  });
});
