import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { enforceGoalPassGates } from '../../src/chat/goal/evaluate.ts';
import {
  MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS,
  MIN_GOAL_TURNS_BEFORE_PASS,
} from '../../src/chat/goal/eval-tools.ts';
import type { ActiveGoalState } from '../../src/types.ts';

function seedGoal(overrides: Partial<ActiveGoalState> = {}): ActiveGoalState {
  return {
    conditionText: 'all tests pass',
    startedAt: 1_700_000_000_000,
    turnCount: MIN_GOAL_TURNS_BEFORE_PASS,
    tokenBaseline: 0,
    ...overrides,
  };
}

describe('enforceGoalPassGates', () => {
  test('passes through NO verdicts unchanged', () => {
    const result = enforceGoalPassGates(
      { met: false, reason: 'tests failing' },
      seedGoal(),
      { verificationToolCalls: 10 },
    );
    assert.equal(result.met, false);
    assert.equal(result.reason, 'tests failing');
  });

  test('blocks YES when turn count is below minimum', () => {
    const result = enforceGoalPassGates(
      { met: true, reason: 'looks good' },
      seedGoal({ turnCount: MIN_GOAL_TURNS_BEFORE_PASS - 1 }),
      { verificationToolCalls: MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS },
    );
    assert.equal(result.met, false);
    assert.match(result.reason, /Pass blocked/);
    assert.match(result.reason, /goal turns/);
  });

  test('blocks YES when verification tool calls are below minimum', () => {
    const result = enforceGoalPassGates(
      { met: true, reason: 'looks good' },
      seedGoal(),
      { verificationToolCalls: MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS - 1 },
    );
    assert.equal(result.met, false);
    assert.match(result.reason, /Pass blocked/);
    assert.match(result.reason, /verification tool call/);
  });

  test('allows YES when all gates pass', () => {
    const result = enforceGoalPassGates(
      { met: true, reason: 'all checks passed' },
      seedGoal(),
      { verificationToolCalls: MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS },
    );
    assert.equal(result.met, true);
    assert.equal(result.reason, 'all checks passed');
  });
});
