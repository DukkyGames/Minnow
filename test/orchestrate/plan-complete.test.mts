/**
 * Orchestrate plan completion helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildOrchestrateCompletionMessage,
  isOrchestratePlanComplete,
  hasIncompleteOrchestrateWork,
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
    assert.equal(hasIncompleteOrchestrateWork(b), false);
  });

  test('false when any task is not complete', () => {
    const b = board([
      { id: 'A', title: 'a', wave: 'W1', category: 'build', status: 'complete' },
      { id: 'B', title: 'b', wave: 'W1', category: 'build', status: 'planned' },
    ]);
    assert.equal(isOrchestratePlanComplete(b), false);
    assert.equal(hasIncompleteOrchestrateWork(b), true);
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
    assert.doesNotMatch(text, /Auto-resume/);
  });

  test('shows quarantined count and unresolved section', () => {
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      orchestratePlanPath: 'documentation/plans/demo-plan.md',
    } as Chat;
    const b = board([
      { id: 'A', title: 'Task Alpha', wave: 'W1', category: 'build', status: 'complete' },
      { id: 'B', title: 'Task Beta', wave: 'W1', category: 'build', status: 'quarantined' },
    ]);
    b.unresolvedIssues = [
      {
        taskId: 'B',
        title: 'Task Beta',
        category: 'code',
        summary: 'Build repeatedly failed',
        resolutionSteps: ['review the failure summary; fix and Requeue'],
        createdAt: END,
        attempts: 2,
      },
    ];
    const text = buildOrchestrateCompletionMessage(chat, b, END);
    assert.match(text, /1\/2 complete/);
    assert.match(text, /\*\*Quarantined:\*\* 1/);
    assert.match(text, /Unresolved \/ quarantined \(1\)/);
    assert.match(text, /Task Beta/);
    assert.match(text, /code/);
    assert.match(text, /Build repeatedly failed/);
    assert.match(text, /review the failure summary/);
    // unresolvedIssues array should be unmutated
    assert.equal(b.unresolvedIssues.length, 1);
  });

  test('all-quarantined board shows blocked headline and 0/N complete', () => {
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      orchestratePlanPath: 'documentation/plans/demo-plan.md',
    } as Chat;
    const b = board([
      { id: 'A', title: 'Task Alpha', wave: 'W1', category: 'build', status: 'quarantined' },
    ]);
    b.unresolvedIssues = [
      {
        taskId: 'A',
        title: 'Task Alpha',
        category: 'infra',
        summary: 'DB not running',
        resolutionSteps: ['ensure `db` running, e.g. `docker compose up -d db`, then Requeue'],
        createdAt: END,
      },
    ];
    const text = buildOrchestrateCompletionMessage(chat, b, END);
    assert.match(text, /Orchestrate plan blocked/);
    assert.match(text, /0\/1 complete/);
    assert.match(text, /\*\*Quarantined:\*\* 1/);
    assert.match(text, /infra/);
  });
});
