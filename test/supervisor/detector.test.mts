/**
 * Supervisor detector unit tests (repetition + stall parity).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { detectRepetition } from '../../src/agents/supervisor/detector.ts';
import {
  evaluateOrchestrateStall,
  ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK,
  ORCHESTRATE_WATCHDOG_STALL_MS,
} from '../../src/agents/supervisor/detector.ts';
import type { OrchestrateWatchdogDeps } from '../../src/agents/supervisor/detector.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';
import type { OrchestrateBoardState } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const NOW = 1_700_000_000_000;

describe('supervisor repetition detector', () => {
  test('duplicate tool calls trigger repetition', () => {
    const log = [
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
    ];
    const result = detectRepetition(log, {
      duplicateToolCallThreshold: 3,
      sameErrorThreshold: 3,
    });
    assert.ok(result);
    assert.equal(result?.reason, 'duplicate_tool');
    assert.equal(result?.repeated, true);
  });

  test('different args do not trigger', () => {
    const log = [
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
      { name: 'read_file', argsJson: '{"path":"b.ts"}' },
      { name: 'read_file', argsJson: '{"path":"c.ts"}' },
    ];
    const result = detectRepetition(log, {
      duplicateToolCallThreshold: 3,
      sameErrorThreshold: 3,
    });
    assert.equal(result, null);
  });
});

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

describe('evaluateOrchestrateStall (watchdog parity)', () => {
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
      deps({ stallMs: ORCHESTRATE_WATCHDOG_STALL_MS }),
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
      deps({ stallMs: ORCHESTRATE_WATCHDOG_STALL_MS }),
    );
    assert.equal(result.stalled, true);
    assert.equal(result.retriesExhausted, true);
  });
});
