/**
 * MIME body preview decoding (base64 / quoted-printable).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decodeBodyPart } from '../../server/email/parse-body.js';

describe('decodeBodyPart', () => {
  test('decodes base64 transfer encoding', () => {
    const raw = Buffer.from('<p>Hello from Google</p>', 'utf8').toString('base64');
    const decoded = decodeBodyPart(Buffer.from(raw), 'base64');
    assert.equal(decoded, '<p>Hello from Google</p>');
  });

  test('decodes quoted-printable transfer encoding', () => {
    const raw = 'Hello=20World=0A';
    const decoded = decodeBodyPart(Buffer.from(raw), 'quoted-printable');
    assert.equal(decoded, 'Hello World\n');
  });

  test('passes through 7bit and 8bit unchanged', () => {
    const raw = Buffer.from('Plain preview text.', 'utf8');
    assert.equal(decodeBodyPart(raw, '7bit'), 'Plain preview text.');
    assert.equal(decodeBodyPart(raw, '8bit'), 'Plain preview text.');
  });
});
