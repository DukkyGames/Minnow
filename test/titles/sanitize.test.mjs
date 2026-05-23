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
    assert.equal(normalizeTitle('I will consider the user request carefully'), null);
    assert.equal(normalizeTitle('The user is asking about Redis cache tuning'), null);
    assert.equal(normalizeTitle('Okay, so let me break this down'), null);
    assert.equal(normalizeTitle('Step 1: understand the question'), null);
    assert.equal(normalizeTitle('Reasoning: need a short sidebar label'), null);
    assert.equal(normalizeTitle('My analysis of the attachment name'), null);
  });

  test('rejects thinking markers anywhere in title', () => {
    const thinkOpen = '<' + 'think>';
    assert.equal(normalizeTitle('Sidebar: chain-of-thought dump'), null);
    assert.equal(normalizeTitle(`Title with ${thinkOpen} tags`), null);
    assert.equal(normalizeTitle('prefix redacted_thinking suffix'), null);
  });

  test('accepts legitimate short titles near thinking words', () => {
    assert.equal(normalizeTitle('Redis cache tuning'), 'Redis cache tuning');
    assert.equal(normalizeTitle('First Redis setup'), 'First Redis setup');
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
