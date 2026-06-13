/**
 * Tests for GSM8K harness extraction and scoring.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  extractGsm8kAnswer,
  normalizeGsm8kNumber,
  scoreGsm8k,
} from '../../../src/benchmark/standard/harnesses/gsm8k.ts';

describe('gsm8k harness', () => {
  test('extractGsm8kAnswer prefers #### marker', () => {
    assert.equal(extractGsm8kAnswer('Step by step...\n#### 18'), '18');
    assert.equal(extractGsm8kAnswer('Work shows 3 and 9 but #### 42'), '42');
  });

  test('extractGsm8kAnswer falls back to last number', () => {
    assert.equal(extractGsm8kAnswer('First we get 3, then 9, so answer is 12.'), '12');
  });

  test('normalizeGsm8kNumber strips commas and integer .0', () => {
    assert.equal(normalizeGsm8kNumber('1,234'), '1234');
    assert.equal(normalizeGsm8kNumber('18.0'), '18');
  });

  test('scoreGsm8k matches normalized ground truth', () => {
    const item = {
      id: 'g1',
      prompt: 'q',
      groundTruth: '18',
      category: 'math' as const,
    };
    assert.equal(scoreGsm8k(item, 'Reasoning...\n#### 18').passed, true);
    assert.equal(scoreGsm8k(item, '#### 18.0').passed, true);
    assert.equal(scoreGsm8k(item, '#### 17').passed, false);
  });
});
