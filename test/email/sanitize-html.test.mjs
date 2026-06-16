/**
 * Email HTML sanitizer tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sanitizeEmailHtml } from '../../server/email/sanitize-html.js';

describe('sanitizeEmailHtml', () => {
  test('strips script tags and keeps safe markup', () => {
    const out = sanitizeEmailHtml(
      '<p>Hello</p><script>alert(1)</script><a href="https://example.com">Link</a>',
    );
    assert.ok(out);
    assert.match(out, /Hello/);
    assert.match(out, /example\.com/);
    assert.doesNotMatch(out, /script/i);
    assert.doesNotMatch(out, /alert/);
  });

  test('returns undefined for empty input', () => {
    assert.equal(sanitizeEmailHtml(''), undefined);
    assert.equal(sanitizeEmailHtml('   '), undefined);
    assert.equal(sanitizeEmailHtml(null), undefined);
  });

  test('blocks javascript: hrefs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">Click</a>');
    assert.ok(out);
    assert.doesNotMatch(out, /javascript:/i);
  });
});
