import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractGoalEvalCompletionText } from '../../src/chat/goal/completion-text.ts';

describe('extractGoalEvalCompletionText', () => {
  test('uses assistant content when present', () => {
    const text = extractGoalEvalCompletionText({
      content: 'YES: tests pass.',
    });
    assert.equal(text, 'YES: tests pass.');
  });

  test('falls back to reasoning when content is empty', () => {
    const text = extractGoalEvalCompletionText({
      content: '',
      reasoning_content: 'NO: tests still failing.',
    });
    assert.equal(text, 'NO: tests still failing.');
  });

  test('falls back to thinking channel', () => {
    const text = extractGoalEvalCompletionText({
      thinking: 'YES: goal met.',
    });
    assert.equal(text, 'YES: goal met.');
  });

  test('strips inline thinking tags and keeps reply verdict', () => {
    const text = extractGoalEvalCompletionText({
      content: '<thinking>I reviewed the code and tests.</thinking>\nYES: tests pass.',
    });
    assert.equal(text, 'YES: tests pass.');
  });

  test('uses thinking block when reply is empty', () => {
    const text = extractGoalEvalCompletionText({
      content: '<thinking>NO: tests still failing.</thinking>',
    });
    assert.equal(text, 'NO: tests still failing.');
  });
});
