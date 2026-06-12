/**
 * Tests for standard benchmark scorers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scoreMcq, scoreNumeric, scoreRegex } from '../../src/benchmark/standard/scorers.ts';

describe('standard scorers', () => {
  test('scoreMcq matches letter answers', () => {
    const item = {
      id: 't1',
      prompt: 'q',
      groundTruth: 'B',
      category: 'reasoning' as const,
    };
    assert.equal(scoreMcq(item, 'The answer is B').passed, true);
    assert.equal(scoreMcq(item, 'A').passed, false);
  });

  test('scoreNumeric extracts final number', () => {
    const item = {
      id: 't2',
      prompt: 'q',
      groundTruth: '42',
      category: 'math' as const,
    };
    assert.equal(scoreNumeric(item, 'Therefore the answer is 42.').passed, true);
    assert.equal(scoreNumeric(item, '41').passed, false);
  });

  test('scoreRegex matches pattern', () => {
    const item = {
      id: 't3',
      prompt: 'q',
      groundTruth: '(?i)\\bno\\b',
      category: 'safety' as const,
    };
    assert.equal(scoreRegex(item, 'No, that is a myth.').passed, true);
    assert.equal(scoreRegex(item, 'Yes').passed, false);
  });
});
