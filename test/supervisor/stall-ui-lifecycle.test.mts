/**
 * Stall UI flag + watchdog toast episode lifecycle (MIN-35).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  beginOrchestrateStallEpisode,
  markChatStalledForUi,
  markOrchestrateWatchdogToastShown,
  pruneStaleStallUiFlag,
  resetSupervisorStateForTests,
  shouldShowOrchestrateStallBadge,
  shouldShowOrchestrateWatchdogToast,
} from '../../src/agents/supervisor/state.ts';
import type { OrchestrateBoardState } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function board(tasks: OrchestrateBoardState['tasks']): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/test.md',
    waves: [{ id: 'W1', status: 'planned' }],
    startedAt: 1_700_000_000_000,
    lastUpdatedAt: 1_700_000_000_000,
    tasks,
  };
}

afterEach(() => {
  resetSupervisorStateForTests();
});

describe('pruneStaleStallUiFlag', () => {
  test('clears sticky flag when all tasks complete', () => {
    markChatStalledForUi(CHAT_ID, true);
    pruneStaleStallUiFlag(
      CHAT_ID,
      board([{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'complete' }]),
      { isStreaming: false, activeRunCount: 0 },
    );
    assert.equal(shouldShowOrchestrateStallBadge(
      CHAT_ID,
      board([{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'complete' }]),
      { isStreaming: false, activeRunCount: 0 },
    ), false);
  });

  test('clears sticky flag while parent streams', () => {
    const incomplete = board([
      { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'planned' },
    ]);
    markChatStalledForUi(CHAT_ID, true);
    pruneStaleStallUiFlag(CHAT_ID, incomplete, {
      isStreaming: true,
      activeRunCount: 0,
    });
    assert.equal(
      shouldShowOrchestrateStallBadge(CHAT_ID, incomplete, {
        isStreaming: true,
        activeRunCount: 0,
      }),
      false,
    );
  });

  test('clears sticky flag while sub-agents are active', () => {
    const incomplete = board([
      { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'in_progress' },
    ]);
    markChatStalledForUi(CHAT_ID, true);
    pruneStaleStallUiFlag(CHAT_ID, incomplete, {
      isStreaming: false,
      activeRunCount: 1,
    });
    assert.equal(
      shouldShowOrchestrateStallBadge(CHAT_ID, incomplete, {
        isStreaming: false,
        activeRunCount: 1,
      }),
      false,
    );
  });
});

describe('watchdog toast episode', () => {
  test('toast allowed once per episode until stall clears', () => {
    markChatStalledForUi(CHAT_ID, true);
    assert.equal(shouldShowOrchestrateWatchdogToast(CHAT_ID), true);
    markOrchestrateWatchdogToastShown(CHAT_ID);
    assert.equal(shouldShowOrchestrateWatchdogToast(CHAT_ID), false);
    markChatStalledForUi(CHAT_ID, false);
    assert.equal(shouldShowOrchestrateWatchdogToast(CHAT_ID), true);
  });

  test('beginOrchestrateStallEpisode resets toast gate', () => {
    markOrchestrateWatchdogToastShown(CHAT_ID);
    beginOrchestrateStallEpisode(CHAT_ID);
    assert.equal(shouldShowOrchestrateWatchdogToast(CHAT_ID), true);
  });
});
