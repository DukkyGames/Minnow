/**
 * Tests for ask_question result formatting in the chat transcript.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ASK_QUESTION_OTHER_ID } from '../../src/tools/ask-question-types.ts';
import {
  formatAskQuestionResultAsListItems,
  formatAskQuestionResultForDisplay,
} from '../../src/ui/format-ask-question-result.ts';

const sampleArgs = {
  questions: [
    {
      id: 'q1',
      prompt: 'Goal?',
      options: [
        { id: 'full', label: 'Full system' },
        { id: 'lite', label: 'Lite' },
      ],
    },
    {
      id: 'q2',
      prompt: 'Notes?',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
  ],
};

describe('formatAskQuestionResultForDisplay', () => {
  test('answered with preset labels', () => {
    const json = JSON.stringify({
      status: 'answered',
      answers: [
        { questionId: 'q1', selectedIds: ['full'], otherText: null },
        { questionId: 'q2', selectedIds: ['b'], otherText: null },
      ],
    });
    const out = formatAskQuestionResultForDisplay(json, sampleArgs);
    assert.ok(out.includes('1. Goal?'));
    assert.ok(out.includes('Full system'));
    assert.ok(out.includes('2. Notes?'));
    assert.ok(out.includes('B'));
  });

  test('Other with text', () => {
    const json = JSON.stringify({
      status: 'answered',
      answers: [
        {
          questionId: 'q1',
          selectedIds: [ASK_QUESTION_OTHER_ID],
          otherText: 'Custom answer',
        },
      ],
    });
    const out = formatAskQuestionResultForDisplay(json, sampleArgs);
    assert.ok(out.includes('Other: Custom answer'));
  });

  test('cancelled', () => {
    const out = formatAskQuestionResultForDisplay(
      JSON.stringify({ status: 'cancelled', answers: [] }),
      sampleArgs,
    );
    assert.equal(out, 'User cancelled questions.');
  });

  test('error status', () => {
    const out = formatAskQuestionResultForDisplay(
      JSON.stringify({ status: 'error', message: 'bad args' }),
      sampleArgs,
    );
    assert.equal(out, 'bad args');
  });
});

describe('formatAskQuestionResultAsListItems', () => {
  test('splits lines', () => {
    const json = JSON.stringify({
      status: 'answered',
      answers: [{ questionId: 'q1', selectedIds: ['lite'], otherText: null }],
    });
    const items = formatAskQuestionResultAsListItems(json, sampleArgs);
    assert.equal(items.length, 1);
    assert.ok(items[0].includes('Lite'));
  });
});
