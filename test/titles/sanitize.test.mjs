/**
 * Title sanitize unit tests (static strings, no network).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeTitle } from '../../src/chat/titles/sanitize.ts';

describe('normalizeTitle', () => {
  test('plain trim', () => {
    assert.equal(normalizeTitle('  Hello World  '), 'Hello World');
  });

  test('strips wrapping quotes', () => {
    assert.equal(normalizeTitle('"Fix bug in sidebar"'), 'Fix bug in sidebar');
  });

  test('long string truncated with ellipsis', () => {
    const long = 'a'.repeat(80);
    const out = normalizeTitle(long);
    assert.ok(out);
    assert.equal(out.length, 41);
    assert.ok(out.endsWith('…'));
  });

  test('whitespace only returns null', () => {
    assert.equal(normalizeTitle('   '), null);
  });

  test('markdown fence stripped', () => {
    assert.equal(normalizeTitle('```foo```'), 'foo');
  });
});
