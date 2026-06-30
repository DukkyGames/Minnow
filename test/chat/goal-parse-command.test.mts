import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseGoalSlashInput,
  MAX_GOAL_CONDITION_CHARS,
} from '../../src/chat/goal/parse-command.ts';

describe('parseGoalSlashInput', () => {
  test('returns null for non-goal commands', () => {
    assert.equal(parseGoalSlashInput('/git-commit fix'), null);
    assert.equal(parseGoalSlashInput('hello'), null);
  });

  test('status when /goal has no args', () => {
    assert.deepEqual(parseGoalSlashInput('/goal'), { kind: 'status' });
    assert.deepEqual(parseGoalSlashInput('  /goal  '), { kind: 'status' });
  });

  test('clear aliases', () => {
    for (const alias of ['clear', 'stop', 'off', 'reset', 'none', 'cancel']) {
      assert.deepEqual(parseGoalSlashInput(`/goal ${alias}`), { kind: 'clear' });
    }
  });

  test('set with condition text', () => {
    const result = parseGoalSlashInput('/goal all tests in test/foo pass');
    assert.deepEqual(result, {
      kind: 'set',
      conditionText: 'all tests in test/foo pass',
    });
  });

  test('truncates very long conditions', () => {
    const long = 'x'.repeat(MAX_GOAL_CONDITION_CHARS + 50);
    const result = parseGoalSlashInput(`/goal ${long}`);
    assert.equal(result?.kind, 'set');
    if (result?.kind === 'set') {
      assert.equal(result.conditionText.length, MAX_GOAL_CONDITION_CHARS);
    }
  });
});
