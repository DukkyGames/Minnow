/**
 * Orchestrate stall watchdog: pure stall evaluation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  evaluateOrchestrateStall,
  ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK,
  ORCHESTRATE_WATCHDOG_STALL_MS,
} from '../../src/chat/orchestrate/watchdog.ts';
import type { OrchestrateWatchdogDeps } from '../../src/chat/orchestrate/watchdog.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';
import type { OrchestrateBoardState } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const NOW = 1_700_000_000_000;

function board(partial: Partial<OrchestrateBoardState> & Pick<OrchestrateBoardState, 'tasks'>): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/test.md',
    waves: [{ id: 'W1', status: 'planned' }],
    startedAt: NOW - 60_000,
    lastUpdatedAt: NOW,
    ...partial,
  };
}

function deps(overrides: Partial<OrchestrateWatchdogDeps> = {}): OrchestrateWatchdogDeps {
  return {
    nowMs: () => NOW,
    isChatStreaming: () => false,
    listActiveSubAgentRuns: () => [],
    getActiveChat: () =>
      ({
        id: CHAT_ID,
        modeId: 'orchestrate',
      }) as ReturnType<OrchestrateWatchdogDeps['getActiveChat']>,
    ...overrides,
  };
}

describe('evaluateOrchestrateStall', () => {
  test('not stalled when all tasks complete', () => {
    const b = board({
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'complete' }],
    });
    const result = evaluateOrchestrateStall(b, CHAT_ID, NOW - ORCHESTRATE_WATCHDOG_STALL_MS - 1, deps());
    assert.equal(result.stalled, false);
  });

  test('not stalled before stall window elapses', () => {
    const b = board({
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'failed' }],
    });
    const recent = NOW - 5_000;
    const result = evaluateOrchestrateStall(b, CHAT_ID, recent, deps());
    assert.equal(result.stalled, false);
  });

  test('not stalled while parent chat is streaming', () => {
    const b = board({
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'planned' }],
    });
    const result = evaluateOrchestrateStall(
      b,
      CHAT_ID,
      NOW - ORCHESTRATE_WATCHDOG_STALL_MS - 5_000,
      deps({ isChatStreaming: () => true }),
    );
    assert.equal(result.stalled, false);
  });

  test('not stalled while sub-agent still active for chat', () => {
    const b = board({
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'in_progress' }],
    });
    const activeRun: SubAgentRun = {
      runId: 'sub-run-1',
      type: 'explore',
      task: 'work',
      status: 'running',
      parentChatId: CHAT_ID,
      parentToolCallId: null,
      parentTurnId: 'turn-1',
      summary: '',
      error: null,
      startedAt: null,
      endedAt: null,
      toolTurns: 0,
      maxToolTurns: 12,
      cancelled: false,
      messages: [],
    };
    const result = evaluateOrchestrateStall(
      b,
      CHAT_ID,
      NOW - ORCHESTRATE_WATCHDOG_STALL_MS - 5_000,
      deps({ listActiveSubAgentRuns: () => [activeRun] }),
    );
    assert.equal(result.stalled, false);
  });

  test('stalled after idle window with incomplete work and no active subs', () => {
    const b = board({
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'failed' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', status: 'planned' },
      ],
    });
    const result = evaluateOrchestrateStall(
      b,
      CHAT_ID,
      NOW - ORCHESTRATE_WATCHDOG_STALL_MS - 1_000,
      deps(),
    );
    assert.equal(result.stalled, true);
    assert.equal(result.blockingTaskId, 'W1-A');
    assert.equal(result.retriesExhausted, false);
  });

  test('retries exhausted when blocking task hit retry cap', () => {
    const b = board({
      tasks: [
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'failed',
          retryCount: ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK,
        },
      ],
    });
    const result = evaluateOrchestrateStall(
      b,
      CHAT_ID,
      NOW - ORCHESTRATE_WATCHDOG_STALL_MS - 1_000,
      deps(),
    );
    assert.equal(result.stalled, true);
    assert.equal(result.retriesExhausted, true);
  });

  test('not stalled without a prior sub-agent terminal timestamp', () => {
    const b = board({
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'planned' }],
    });
    const result = evaluateOrchestrateStall(b, CHAT_ID, undefined, deps());
    assert.equal(result.stalled, false);
  });
});
