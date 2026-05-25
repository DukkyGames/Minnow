/**
 * Speed suite pass criteria (BUG-003): empty completions must not pass.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { speedCompletionDetails } from '../../src/benchmark/completion-valid.ts';
import { scoreSpeedCompletion } from '../../src/benchmark/suites/speed.ts';

const SAMPLE_TIMING = { ttftMs: 120, tokPerSec: 42 };

describe('scoreSpeedCompletion (BUG-003)', () => {
  test('empty text fails with explicit details and no timing samples', () => {
    const scored = scoreSpeedCompletion('', SAMPLE_TIMING);
    assert.equal(scored.passed, false);
    assert.equal(scored.score, 0);
    assert.equal(scored.details, 'empty completion (0 chars)');
    assert.equal(scored.ttftSample, null);
    assert.equal(scored.tpsSample, null);
  });

  test('whitespace-only text fails like empty completion', () => {
    const scored = scoreSpeedCompletion('   \n\t  ', SAMPLE_TIMING);
    assert.equal(scored.passed, false);
    assert.equal(scored.score, 0);
    assert.equal(scored.details, 'empty completion (0 chars)');
  });

  test('non-empty text passes and contributes timing samples', () => {
    const scored = scoreSpeedCompletion('Hello from the model.', SAMPLE_TIMING);
    assert.equal(scored.passed, true);
    assert.equal(scored.score, 1);
    assert.equal(scored.details, '21 chars');
    assert.equal(scored.ttftSample, SAMPLE_TIMING.ttftMs);
    assert.equal(scored.tpsSample, SAMPLE_TIMING.tokPerSec);
  });
});

describe('speedCompletionDetails helper', () => {
  test('empty text yields fail message', () => {
    assert.equal(speedCompletionDetails(''), 'empty completion (0 chars)');
    assert.equal(speedCompletionDetails('   '), 'empty completion (0 chars)');
  });

  test('non-empty text yields char count', () => {
    assert.equal(speedCompletionDetails('abc'), '3 chars');
  });
});
