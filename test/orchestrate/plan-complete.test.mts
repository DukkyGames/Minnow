/**
 * Orchestrate plan completion helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildOrchestrateCompletionMessage,
  canOrchestrateResume,
  isOrchestratePlanComplete,
} from '../../src/chat/orchestrate/plan-complete.ts';
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';

const END = 2_000_000_000_000;
const START = END - 125_000;

function board(tasks: OrchestrateBoardState['tasks']): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/demo-plan.md',
    startedAt: START,
    lastUpdatedAt: END,
    waves: [{ id: 'W1', status: 'complete' }],
    tasks,
  };
}

describe('isOrchestratePlanComplete', () => {
  test('false for empty task list', () => {
    assert.equal(isOrchestratePlanComplete(board([])), false);
  });

  test('true when every task is complete', () => {
    const b = board([
      { id: 'A', title: 'a', wave: 'W1', category: 'build', status: 'complete' },
      { id: 'B', title: 'b', wave: 'W1', category: 'test', status: 'complete' },
    ]);
    assert.equal(isOrchestratePlanComplete(b), true);
    assert.equal(canOrchestrateResume(b), false);
  });

  test('false when any task is not complete', () => {
    const b = board([
      { id: 'A', title: 'a', wave: 'W1', category: 'build', status: 'complete' },
      { id: 'B', title: 'b', wave: 'W1', category: 'build', status: 'planned' },
    ]);
    assert.equal(isOrchestratePlanComplete(b), false);
    assert.equal(canOrchestrateResume(b), true);
  });
});

describe('buildOrchestrateCompletionMessage', () => {
  test('includes plan name, task count, and elapsed time', () => {
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      orchestratePlanPath: 'documentation/plans/demo-plan.md',
    } as Chat;
    const b = board([
      { id: 'A', title: 'a', wave: 'W1', category: 'build', status: 'complete' },
    ]);
    const text = buildOrchestrateCompletionMessage(chat, b, END);
    assert.match(text, /demo-plan/);
    assert.match(text, /1\/1 complete/);
    assert.match(text, /2m 5s/);
    assert.match(text, /Auto-resume is off/);
  });
});
