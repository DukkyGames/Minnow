/**
 * Tests for MCQ harness (migrated from standard-scorers).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scoreMcq } from '../../../src/benchmark/standard/harnesses/mcq.ts';

describe('mcq harness', () => {
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

  test('scoreMcq uses final letter when reasoning lists all options', () => {
    const item = {
      id: 't1b',
      prompt: 'q',
      groundTruth: 'B',
      category: 'reasoning' as const,
    };
    const reasoning = [
      'Evaluate the Options:',
      'A) Ag - Silver',
      'B) Au - Gold',
      'C) Fe - Iron',
      'D) Pb - Lead',
      'Select the Correct Option: Option B corresponds to Au.',
      'Construct Final Response: B',
    ].join('\n');
    assert.equal(scoreMcq(item, reasoning).passed, true);
    assert.equal(scoreMcq(item, reasoning.replace('Construct Final Response: B', '')).passed, true);
  });

  test('scoreMcq flags out-of-range extracted letters when choices provided', () => {
    const item = {
      id: 't1c',
      prompt: 'q',
      groundTruth: 'B',
      choices: ['one', 'two'],
      category: 'reasoning' as const,
    };
    const result = scoreMcq(item, 'The answer is E');
    assert.equal(result.passed, false);
    assert.match(result.details ?? '', /out of range/i);
  });
});
