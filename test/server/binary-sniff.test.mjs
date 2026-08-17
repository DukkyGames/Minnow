/**
 * Binary sniff for read_file — refuse to dump ZIP/OLE/image bytes as UTF-8.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { looksLikeBinaryBuffer } from '../../server/tools/binary-sniff.js';

describe('looksLikeBinaryBuffer', () => {
  it('treats empty and UTF-8 text as not binary', () => {
    assert.equal(looksLikeBinaryBuffer(Buffer.alloc(0)), false);
    assert.equal(looksLikeBinaryBuffer(Buffer.from('hello\nworld', 'utf8')), false);
  });

  it('detects ZIP local-file header used by xlsx (NUL after PK)', () => {
    // Minimal ZIP local header: PK\x03\x04 then zeros in the rest of the header.
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    assert.equal(looksLikeBinaryBuffer(zip), true);
  });

  it('detects a NUL in the leading sample', () => {
    assert.equal(looksLikeBinaryBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])), true);
  });
});
