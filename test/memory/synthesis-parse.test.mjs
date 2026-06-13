/**
 * Parser and secret-rejection tests for memory synthesis.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  containsSecretPatterns,
  normalizeExtractedFact,
  parseExtractionJson,
} from '../../server/memory/synthesis.js';

describe('memory synthesis parse', () => {
  test('parses valid JSON array', () => {
    const raw = `[{"title":"City","body":"Lives in Austin","tags":["location"],"category":"fact","confidence":0.9,"rationale":"stated"}]`;
    const rows = parseExtractionJson(raw);
    assert.equal(rows.length, 1);
    const fact = normalizeExtractedFact(rows[0]);
    assert.ok(fact);
    assert.equal(fact.title, 'City');
    assert.equal(fact.body, 'Lives in Austin');
  });

  test('parses JSON wrapped in markdown fences', () => {
    const raw =
      '```json\n[{"title":"Name","body":"Sam","category":"identity","confidence":0.8}]\n```';
    const rows = parseExtractionJson(raw);
    assert.equal(rows.length, 1);
  });

  test('returns empty array for malformed JSON', () => {
    const rows = parseExtractionJson('not json at all { broken');
    assert.deepEqual(rows, []);
  });

  test('rejects facts containing API key patterns', () => {
    assert.equal(containsSecretPatterns('sk-abcdefghijklmnopqrstuvwxyz'), true);
    const fact = normalizeExtractedFact({
      title: 'Key',
      body: 'api_key=supersecret',
      confidence: 0.9,
    });
    assert.equal(fact, null);
  });

  test('rejects Bearer token patterns', () => {
    const fact = normalizeExtractedFact({
      title: 'Token',
      body: 'Bearer abcdefgh12345678',
      confidence: 0.9,
    });
    assert.equal(fact, null);
  });

  test('accepts clean preference facts', () => {
    const fact = normalizeExtractedFact({
      title: 'Testing',
      body: 'Prefers npm test before commits',
      category: 'preference',
      confidence: 0.85,
      tags: ['workflow'],
    });
    assert.ok(fact);
    assert.equal(fact.category, 'preference');
    assert.deepEqual(fact.tags, ['workflow']);
  });
});
