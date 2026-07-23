/**
 * MIME body preview decoding (base64 / quoted-printable) and snippet sanitization.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildBodyPreview,
  decodeBodyPart,
  repairUtf8Mojibake,
  sanitizePreviewText,
  stripHtmlToText,
} from '../../server/email/parse-body.js';

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

  test('decodes quoted-printable UTF-8 multibyte sequences', () => {
    const raw = 'Innovation at an amazing price.=E2=80=8C=E2=80=8C';
    const decoded = decodeBodyPart(Buffer.from(raw), 'quoted-printable');
    assert.equal(decoded, 'Innovation at an amazing price.\u200c\u200c');
  });

  test('passes through 7bit and 8bit unchanged', () => {
    const raw = Buffer.from('Plain preview text.', 'utf8');
    assert.equal(decodeBodyPart(raw, '7bit'), 'Plain preview text.');
    assert.equal(decodeBodyPart(raw, '8bit'), 'Plain preview text.');
  });
});

describe('sanitizePreviewText', () => {
  test('strips zero-width characters from HTML entity previews', () => {
    const html = '<p>Innovation and reliability at an amazing price.&#8203;&#8203;</p>';
    assert.equal(
      stripHtmlToText(html),
      'Innovation and reliability at an amazing price.',
    );
  });

  test('repairs mojibake left by a byte-wise quoted-printable decode', () => {
    const corrupt = 'Innovation and reliability at an amazing price.\u00e2\u0080\u008c\u00e2\u0080\u008c';
    assert.equal(
      sanitizePreviewText(corrupt),
      'Innovation and reliability at an amazing price.',
    );
  });

  test('buildBodyPreview truncates after sanitization', () => {
    const html = `<p>${'word '.repeat(80)}&#8203;</p>`;
    const preview = buildBodyPreview(stripHtmlToText(html), 40);
    assert.equal(preview.length, 40);
    assert.ok(preview.endsWith('…'));
    assert.doesNotMatch(preview, /&#8203;/);
  });

  test('repairUtf8Mojibake leaves normal UTF-8 untouched', () => {
    const text = 'café résumé — 日本語 €100';
    assert.equal(repairUtf8Mojibake(text), text);
  });
});
