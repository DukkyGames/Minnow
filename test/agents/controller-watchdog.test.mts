/**
 * MIN-140 Phase 2 — watchdog state machine + tiered recovery.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getSubAgentRun,
  listActiveSubAgentRuns,
  recordToolCallForRun,
  resetSubAgentOrchestrator,
  spawnSubAgent,
} from '../../src/agents/orchestrator.ts';
import {
  isNonMutatingSubAgentRun,
  resetWatchdogState,
  setWatchdogMonotonicNow,
  stopWatchdog,
  tickWatchdog,
} from '../../src/agents/controller/watchdog.ts';
import { bumpProgress, recordHeartbeat, setHeartbeatConfig } from '../../src/agents/controller/wrapper.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import {
  createMockSubAgentRunner,
  FIXED_RUN_ID,
  nextFixedRunId,
  resetRunIdCounter,
} from '../sub-agents/test-helpers.mts';
import type { SubAgentRunner } from '../../src/agents/types.ts';

const PARENT_CHAT = '11111111-1111-1111-1111-111111111111';

function hangingRunner(): SubAgentRunner {
  return {
    async run(input) {
      input.onMessagesChange?.([
        { role: 'system', content: 'mock' },
        { role: 'user', content: input.task },
      ]);
      await new Promise(() => {
        /* never resolves — watchdog stall */
      });
      return {
        summary: 'never',
        toolTurns: 0,
        messages: [],
      };
    },
  };
}

function rejectingRunner(): SubAgentRunner {
  return {
    async run() {
      throw new Error('mock reject');
    },
  };
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function waitForRunActive(runId: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const run = getSubAgentRun(runId);
    if (run?.status === 'running') {
      if (run.lastProgressAt == null) bumpProgress(runId);
      return;
    }
    await flushAsync();
  }
  throw new Error(`run ${runId} did not reach running`);
}

describe('controller watchdog', () => {
  let now = 0;
  let originalNow: typeof performance.now;
  let runIdSeq = 0;

  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    resetWatchdogState();
    stopWatchdog();

    now = 0;
    originalNow = performance.now;
    performance.now = () => now;
    setWatchdogMonotonicNow(() => now);

    setHeartbeatConfig({
      heartbeatIntervalMs: 100,
      progressStallMs: 1_000,
      heartbeatDeadMs: 10_000,
    });

    runIdSeq = 0;
    setSubAgentRunIdFactory(() => {
      runIdSeq += 1;
      return runIdSeq === 1 ? FIXED_RUN_ID : nextFixedRunId();
    });
  });

  afterEach(() => {
    stopWatchdog();
    performance.now = originalNow;
    resetSubAgentOrchestrator();
    stopWatchdog();
  });

  test('non-mutating explore run is eligible for tier-1', () => {
    assert.equal(
      isNonMutatingSubAgentRun({
        runId: 'r1',
        type: 'explore',
        task: 't',
        status: 'running',
        parentChatId: null,
        parentToolCallId: null,
        parentTurnId: null,
        summary: '',
        error: null,
        startedAt: null,
        endedAt: null,
        toolTurns: 0,
        maxToolTurns: 10,
        cancelled: false,
        messages: [],
        category: 'research',
      }),
      true,
    );
    assert.equal(
      isNonMutatingSubAgentRun({
        runId: 'r2',
        type: 'shell',
        task: 't',
        status: 'running',
        parentChatId: null,
        parentToolCallId: null,
        parentTurnId: null,
        summary: '',
        error: null,
        startedAt: null,
        endedAt: null,
        toolTurns: 0,
        maxToolTurns: 10,
        cancelled: false,
        messages: [],
        category: 'build',
      }),
      false,
    );
  });

  test('progress stall on explore triggers tier-1 recovery', async () => {
    setSubAgentRunnerFactory(() => hangingRunner());

    await spawnSubAgent({
      type: 'explore',
      task: 'Stall test',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-1',
      category: 'research',
    });

    await waitForRunActive(FIXED_RUN_ID);

    setHeartbeatConfig({
      heartbeatIntervalMs: 100,
      progressStallMs: 1_000,
      heartbeatDeadMs: 10_000,
    });

    now = 2_000;
    recordHeartbeat(FIXED_RUN_ID);
    tickWatchdog();
    await flushAsync();

    const after = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(after?.status, 'cancelled');
    assert.equal(after?.error, 'watchdog_tier1_restart');

    const active = listActiveSubAgentRuns().filter((r) => r.status === 'running');
    assert.equal(active.length, 1);
    assert.notEqual(active[0]?.runId, FIXED_RUN_ID);
    assert.equal(active[0]?.attempt, 2);
    assert.equal(active[0]?.lifecycle, 'dispatching');
  });

  test('progress stall on shell triggers tier-2 surface', async () => {
    setSubAgentRunnerFactory(() => hangingRunner());

    await spawnSubAgent({
      type: 'shell',
      task: 'Mutating stall',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-2',
      category: 'build',
    });

    await waitForRunActive(FIXED_RUN_ID);

    setHeartbeatConfig({
      heartbeatIntervalMs: 100,
      progressStallMs: 1_000,
      heartbeatDeadMs: 10_000,
    });

    now = 2_000;
    recordHeartbeat(FIXED_RUN_ID);
    tickWatchdog();
    await flushAsync();

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'cancelled');
    assert.match(run?.error ?? '', /^watchdog_tier2:/);
  });

  test('mock runner rejection settles failed', async () => {
    setSubAgentRunnerFactory(() => rejectingRunner());

    const result = await spawnSubAgent({
      type: 'explore',
      task: 'Reject test',
      wait: true,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-3',
    });

    assert.equal(result.status, 'failed');
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.lifecycle, 'failed');
    assert.match(run?.error ?? '', /mock reject/);
  });

  test('repetition detection triggers tier-2 for mutating runs', async () => {
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5_000 }));

    await spawnSubAgent({
      type: 'shell',
      task: 'Loop test',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-4',
      category: 'build',
    });

    const args = { pattern: 'auth' };
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    await flushAsync();

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'cancelled');
    assert.match(run?.error ?? '', /watchdog_tier2:duplicate_tool/);
  });
});
