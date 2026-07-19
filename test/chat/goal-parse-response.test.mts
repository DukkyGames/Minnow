import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseGoalEvalResponse, isGoalEvalVerdictResponse } from '../../src/chat/goal/parse-response.ts';

describe('parseGoalEvalResponse', () => {
  test('parses YES with reason', () => {
    const result = parseGoalEvalResponse('YES: All tests pass.');
    assert.equal(result.met, true);
    assert.equal(result.reason, 'All tests pass.');
  });

  test('parses NO with reason', () => {
    const result = parseGoalEvalResponse('NO - still failing lint.');
    assert.equal(result.met, false);
    assert.equal(result.reason, 'still failing lint.');
  });

  test('malformed response is treated as not met', () => {
    const result = parseGoalEvalResponse('maybe later');
    assert.equal(result.met, false);
    assert.match(result.reason, /malformed/i);
  });

  test('empty response is treated as not met', () => {
    const result = parseGoalEvalResponse('   ');
    assert.equal(result.met, false);
    assert.match(result.reason, /empty/i);
  });

  test('parses YES on trailing line after reasoning prose', () => {
    const result = parseGoalEvalResponse(
      'Reviewing the transcript...\nThe tests were run and passed.\nYES: all unit tests pass.',
    );
    assert.equal(result.met, true);
    assert.equal(result.reason, 'all unit tests pass.');
  });

  test('parses markdown-bold YES verdict', () => {
    const result = parseGoalEvalResponse('**YES**: all unit tests pass.');
    assert.equal(result.met, true);
    assert.equal(result.reason, 'all unit tests pass.');
  });

  test('parses Answer: NO embedded verdict', () => {
    const result = parseGoalEvalResponse('After review, Answer: NO - tests still failing.');
    assert.equal(result.met, false);
    assert.equal(result.reason, 'tests still failing.');
  });

  test('parses JSON met/reason payload', () => {
    const result = parseGoalEvalResponse(
      '{"met": true, "reason": "All checks passed."}',
    );
    assert.equal(result.met, true);
    assert.equal(result.reason, 'All checks passed.');
  });

  test('parses bullet-list YES verdict', () => {
    const result = parseGoalEvalResponse('- YES: nav bar matches spec.');
    assert.equal(result.met, true);
    assert.equal(result.reason, 'nav bar matches spec.');
  });

  test('isGoalEvalVerdictResponse is false for analysis without verdict', () => {
    const raw =
      '- Nav: `h-[52px]` (matches `topbar-h: "52px"`), `bg-[var(--mn-bg)]`, `border-b`';
    assert.equal(isGoalEvalVerdictResponse(raw), false);
  });
});
