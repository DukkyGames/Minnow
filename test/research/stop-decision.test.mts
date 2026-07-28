/**
 * Deep Research stop-decision parsing and strip-thinking helpers.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isLowQuality,
  LOW_QUALITY_MARKERS,
  parseStopDecision,
  stripThinking,
} from '../../server/research/strip-thinking.js';

describe('stripThinking', () => {
  test('preserves null and undefined', () => {
    assert.equal(stripThinking(null), null);
    assert.equal(stripThinking(undefined), undefined);
  });

  test('removes closed redacted_thinking blocks', () => {
    const input = '<think>internal reasoning</think>YES — done.';
    assert.equal(stripThinking(input), 'YES — done.');
  });

  test('removes nested thinking blocks', () => {
    const input =
      '<think>outer<think>inner</think></think>Answer';
    assert.equal(stripThinking(input), 'Answer');
  });

  test('removes dangling unclosed thinking tags', () => {
    const input = '<think>still thinking...';
    assert.equal(stripThinking(input), '');
  });

  test('strips Qwen Thinking Process preamble', () => {
    const input = 'Thinking Process: step one\n\n# Report\n\nBody';
    assert.equal(stripThinking(input), '# Report\n\nBody');
  });

  test('strips prompt-echo headers', () => {
    const input = 'The user asks: something\n\n**Summary**\n\nDone';
    assert.equal(stripThinking(input), '**Summary**\n\nDone');
  });
});

describe('parseStopDecision', () => {
  test('returns true when answer starts with YES after thinking strip', () => {
    assert.equal(
      parseStopDecision(
        '<think>weighing options</think>YES — coverage is sufficient.',
      ),
      true,
    );
  });

  test('tolerates markdown emphasis and punctuation', () => {
    assert.equal(parseStopDecision('**YES** — ready.'), true);
    assert.equal(parseStopDecision('"Yes."'), true);
    assert.equal(parseStopDecision('> NO — need more on pricing.'), false);
  });

  test('returns false for empty or missing answers', () => {
    assert.equal(parseStopDecision(''), false);
    assert.equal(parseStopDecision(null), false);
    assert.equal(parseStopDecision('<think>only thinking</think>'), false);
  });

  test('returns false on malformed input (continue on error)', () => {
    const broken = {
      toString() {
        throw new Error('boom');
      },
    };
    assert.equal(parseStopDecision(/** @type {string} */ (broken)), false);
  });
});

describe('isLowQuality', () => {
  test('exports the low-quality marker list verbatim', () => {
    assert.deepEqual(LOW_QUALITY_MARKERS, [
      'insufficient to',
      'content is insufficient',
      'no substantive data',
      'does not contain',
      'not relevant to',
      'no relevant information',
      'unable to extract',
      'completely unrelated',
      'boilerplate',
      'footer text',
      'cookie consent',
      'cookie banner',
      'cookie notice',
      'copyright notice',
      'copyright footer',
      'all rights reserved',
    ]);
  });

  test('flags boilerplate summaries', () => {
    assert.equal(isLowQuality('This page shows a cookie consent banner only.'), true);
    assert.equal(isLowQuality('Detailed analysis of EU copyright law reforms.'), false);
  });

  test('treats empty and non-string summaries as low quality', () => {
    assert.equal(isLowQuality(''), true);
    assert.equal(isLowQuality(null), true);
    assert.equal(isLowQuality(undefined), true);
  });

  test('does not flag legitimate findings that mention cookies in prose', () => {
    assert.equal(
      isLowQuality('The article explains how third-party cookies affect ad targeting.'),
      false,
    );
  });
});
