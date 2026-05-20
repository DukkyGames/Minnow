/**
 * Tests for ask-question draft validation helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ASK_QUESTION_OTHER_ID } from '../../src/tools/ask-question-types.ts';
import {
  areAllDraftsValid,
  buildAnswerEntries,
  isDraftValidForQuestion,
  type AskQuestionAnswerDraft,
} from '../../src/ui/question-cards-state.ts';

const qSingle = {
  id: 'q1',
  prompt: 'Pick',
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
};

const qMulti = {
  id: 'q2',
  prompt: 'Pick many',
  options: [
    { id: 'x', label: 'X' },
    { id: 'y', label: 'Y' },
  ],
  allow_multiple: true as const,
};

describe('isDraftValidForQuestion', () => {
  test('single: requires one preset', () => {
    assert.equal(
      isDraftValidForQuestion(qSingle, { selectedIds: ['a'], otherText: '' }),
      true,
    );
    assert.equal(
      isDraftValidForQuestion(qSingle, { selectedIds: [], otherText: '' }),
      false,
    );
  });

  test('single: Other requires text', () => {
    assert.equal(
      isDraftValidForQuestion(qSingle, {
        selectedIds: [ASK_QUESTION_OTHER_ID],
        otherText: '  ',
      }),
      false,
    );
    assert.equal(
      isDraftValidForQuestion(qSingle, {
        selectedIds: [ASK_QUESTION_OTHER_ID],
        otherText: 'custom',
      }),
      true,
    );
  });

  test('multi: two presets', () => {
    assert.equal(
      isDraftValidForQuestion(qMulti, { selectedIds: ['x', 'y'], otherText: '' }),
      true,
    );
  });

  test('multi: Other only with text', () => {
    assert.equal(
      isDraftValidForQuestion(qMulti, {
        selectedIds: [ASK_QUESTION_OTHER_ID],
        otherText: 'ok',
      }),
      true,
    );
    assert.equal(
      isDraftValidForQuestion(qMulti, {
        selectedIds: ['x', ASK_QUESTION_OTHER_ID],
        otherText: 'bad',
      }),
      false,
    );
  });
});

describe('areAllDraftsValid + buildAnswerEntries', () => {
  test('round-trip', () => {
    const drafts = new Map<string, AskQuestionAnswerDraft>([
      ['q1', { selectedIds: ['b'], otherText: '' }],
      ['q2', { selectedIds: [ASK_QUESTION_OTHER_ID], otherText: '  z  ' }],
    ]);
    assert.equal(areAllDraftsValid([qSingle, qMulti], drafts), true);
    const entries = buildAnswerEntries([qSingle, qMulti], drafts);
    assert.deepEqual(entries, [
      { questionId: 'q1', selectedIds: ['b'], otherText: null },
      { questionId: 'q2', selectedIds: [ASK_QUESTION_OTHER_ID], otherText: 'z' },
    ]);
  });
});
