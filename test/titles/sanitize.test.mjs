/**
 * Title sanitize unit tests (static strings, no network).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  fallbackTitleFromSeed,
  normalizeTitle,
} from '../../src/chat/titles/sanitize.ts';

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

  test('accepts non-Latin letters', () => {
    assert.equal(normalizeTitle('Redis 缓存调优'), 'Redis 缓存调优');
  });

  test('rejects thinking boilerplate openers', () => {
    assert.equal(
      normalizeTitle("Here's a thinking process for your request"),
      null,
    );
    assert.equal(normalizeTitle('Let me analyze this step by step'), null);
  });

  test('UNTITLED maps to null', () => {
    assert.equal(normalizeTitle('UNTITLED'), null);
    assert.equal(normalizeTitle('untitled'), null);
  });
});

describe('fallbackTitleFromSeed', () => {
  test('truncates long user message', () => {
    const seed = 'a'.repeat(80);
    const out = fallbackTitleFromSeed(seed);
    assert.ok(out);
    assert.equal(out.length, 41);
    assert.ok(out.endsWith('…'));
  });

  test('returns trimmed seed for short message', () => {
    assert.equal(fallbackTitleFromSeed('  How do I tune Redis?  '), 'How do I tune Redis?');
  });
});
