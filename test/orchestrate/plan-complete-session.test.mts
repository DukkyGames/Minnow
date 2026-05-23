/**
 * Orchestrate supervisor session gating (auto-resume on new/idle chats).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hasOrchestrateSupervisorSessionStarted } from '../../src/chat/orchestrate/plan-complete.ts';
import { getSupervisorChatState } from '../../src/agents/supervisor/state.ts';
import type { OrchestrateBoardState } from '../../src/types.ts';

const CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function board(tasks: OrchestrateBoardState['tasks']): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/test.md',
    startedAt: 1_700_000_000_000,
    lastUpdatedAt: 1_700_000_000_000,
    waves: [{ id: 'W1', status: 'planned' }],
    tasks,
  };
}

describe('hasOrchestrateSupervisorSessionStarted', () => {
  test('false for fresh board with only startedAt', () => {
    const sup = getSupervisorChatState(CHAT_ID);
    const b = board([{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'planned' }]);
    assert.equal(hasOrchestrateSupervisorSessionStarted(sup, b), false);
  });

  test('true after a sub-agent terminal event', () => {
    const sup = getSupervisorChatState(CHAT_ID);
    sup.lastTerminalAt = 1_700_000_100_000;
    const b = board([{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'planned' }]);
    assert.equal(hasOrchestrateSupervisorSessionStarted(sup, b), true);
  });

  test('true when any task left planned', () => {
    const sup = getSupervisorChatState(CHAT_ID);
    const b = board([{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'in_progress' }]);
    assert.equal(hasOrchestrateSupervisorSessionStarted(sup, b), true);
  });
});
