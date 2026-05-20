/**
 * Tests for ask_question argument validation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ASK_QUESTION_OTHER_ID,
  validateAskQuestionArgs,
} from '../../src/tools/ask-question-types.ts';

const validQ = (id: string) => ({
  id,
  prompt: 'Pick one',
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
});

describe('validateAskQuestionArgs', () => {
  test('accepts minimal valid payload', () => {
    const r = validateAskQuestionArgs({ questions: [validQ('q1')] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.args.questions.length, 1);
      assert.equal(r.args.questions[0].id, 'q1');
    }
  });

  test('accepts optional title', () => {
    const r = validateAskQuestionArgs({
      title: 'Theme',
      questions: [validQ('q1')],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.args.title, 'Theme');
  });

  test('rejects empty questions', () => {
    const r = validateAskQuestionArgs({ questions: [] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.error.includes('questions'));
  });

  test('rejects more than 10 questions', () => {
    const questions = Array.from({ length: 11 }, (_, i) => validQ(`q${i}`));
    const r = validateAskQuestionArgs({ questions });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.error.includes('10'));
  });

  test('rejects duplicate question ids', () => {
    const r = validateAskQuestionArgs({
      questions: [validQ('same'), validQ('same')],
    });
    assert.equal(r.ok, false);
  });

  test('rejects fewer than two options', () => {
    const r = validateAskQuestionArgs({
      questions: [{ id: 'q1', prompt: 'x', options: [{ id: 'a', label: 'Only' }] }],
    });
    assert.equal(r.ok, false);
  });

  test('rejects reserved __other__ option id', () => {
    const r = validateAskQuestionArgs({
      questions: [
        {
          id: 'q1',
          prompt: 'x',
          options: [
            { id: ASK_QUESTION_OTHER_ID, label: 'bad' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    assert.equal(r.ok, false);
  });

  test('rejects duplicate option ids within a question', () => {
    const r = validateAskQuestionArgs({
      questions: [
        {
          id: 'q1',
          prompt: 'x',
          options: [
            { id: 'dup', label: '1' },
            { id: 'dup', label: '2' },
          ],
        },
      ],
    });
    assert.equal(r.ok, false);
  });
});
