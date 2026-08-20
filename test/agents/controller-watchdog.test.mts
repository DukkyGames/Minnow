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
  setRepetitionThresholds,
  setWatchdogMonotonicNow,
  stopWatchdog,
  tickWatchdog,
} from '../../src/agents/controller/watchdog.ts';
import { bumpProgress, recordHeartbeat, resetWrapperState, setHeartbeatConfig, simulatePageVisibilityForTests, supervisionMonotonicNow } from '../../src/agents/controller/wrapper.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  createMockSubAgentRunner,
  FIXED_RUN_ID,
  nextFixedRunId,
  resetRunIdCounter,
} from '../sub-agents/test-helpers.mts';
import type { SubAgentRunner } from '../../src/agents/types.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PARENT_CHAT = '11111111-1111-1111-1111-111111111111';
const AFK_TASK_CHAT = '22222222-2222-2222-2222-222222222222';
const AFK_GROUP_ID = 'grp_afk_test';

function makeAfkSessionState() {
  const planner: Chat = {
    id: PARENT_CHAT,
    name: 'Planner',
    workspacePath: '/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: AFK_GROUP_ID,
  };
  const taskChat: Chat = {
    id: AFK_TASK_CHAT,
    name: 'Task',
    workspacePath: '/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: AFK_GROUP_ID,
  };
  const group: ChatGroup = {
    id: AFK_GROUP_ID,
    name: 'Board',
    workspacePath: '/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PARENT_CHAT,
    orchestrateBoard: {
      planPath: 'plan.md',
      startedAt: 1,
      lastUpdatedAt: 2,
      waves: [{ id: 'W1', status: 'in_progress' }],
      tasks: [],
      executionMode: 'afk',
      autoRunning: true,
    },
  };
  return { version: 5 as const, activeId: PARENT_CHAT, sidebarCollapsed: false, chats: [planner, taskChat], groups: [group] };
}

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
    setSessionStateForTests({ version: 5, activeId: null, sidebarCollapsed: false, chats: [], groups: [] });

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

  test('tier-1 restarts stop at the recovery attempt cap', async () => {
    setSubAgentRunnerFactory(() => hangingRunner());

    await spawnSubAgent({
      type: 'explore',
      task: 'Repeated stall',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-cap',
      category: 'research',
    });

    const dispatched: string[] = [];
    let currentId = FIXED_RUN_ID;
    let surfaced = false;

    for (let i = 0; i < 12 && !surfaced; i += 1) {
      await waitForRunActive(currentId);
      dispatched.push(currentId);

      // executeRun resets the shared thresholds from config on every dispatch.
      setHeartbeatConfig({
        heartbeatIntervalMs: 100,
        progressStallMs: 1_000,
        heartbeatDeadMs: 10_000,
      });

      now += 2_000;
      recordHeartbeat(currentId);
      tickWatchdog();
      await flushAsync();

      const settled = getSubAgentRun(currentId);
      assert.equal(settled?.status, 'cancelled');

      if (settled?.error?.startsWith('watchdog_tier2:')) {
        surfaced = true;
        break;
      }

      assert.equal(settled?.error, 'watchdog_tier1_restart');
      const next = settled?.supersededByRunId;
      assert.ok(next, 'tier-1 restart must record a successor run');
      currentId = next;
    }

    // selfHealMaxRounds defaults to 4: attempts 1-3 restart, attempt 4 surfaces.
    assert.equal(surfaced, true, 'watchdog must stop restarting and surface');
    assert.equal(dispatched.length, 4);
    assert.equal(new Set(dispatched).size, 4);
    assert.equal(
      listActiveSubAgentRuns().filter((r) => r.status === 'running').length,
      0,
    );
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

  test('AFK board: mutating run stall uses tier2AutoRecover (watchdog_tier2_autorecover: error)', async () => {
    setSubAgentRunnerFactory(() => hangingRunner());
    setSessionStateForTests(makeAfkSessionState());

    await spawnSubAgent({
      type: 'shell',
      task: 'AFK stall test',
      wait: false,
      parentChatId: AFK_TASK_CHAT,
      parentTurnId: 'turn-afk-1',
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
    assert.match(
      run?.error ?? '',
      /^watchdog_tier2_autorecover:/,
      'AFK-supervised run should use auto-recover path, not surface',
    );
  });

  test('non-AFK mutating run stall uses tier2Surface (watchdog_tier2: error)', async () => {
    setSubAgentRunnerFactory(() => hangingRunner());
    // No AFK session state → isRunAfkSupervised returns false

    await spawnSubAgent({
      type: 'shell',
      task: 'Non-AFK stall test',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-nonafk-1',
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
    assert.match(
      run?.error ?? '',
      /^watchdog_tier2:/,
      'Non-AFK run should use surface path',
    );
    assert.doesNotMatch(
      run?.error ?? '',
      /^watchdog_tier2_autorecover:/,
      'Non-AFK run must NOT use auto-recover path',
    );
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

    await waitForRunActive(FIXED_RUN_ID);
    setRepetitionThresholds({ duplicateToolCallThreshold: 5 });

    const args = { pattern: 'auth' };
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    await flushAsync();

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'cancelled');
    assert.match(run?.error ?? '', /watchdog_tier2:duplicate_tool/);
  });

  test('watchdog does not false-positive after visibility baseline reset', async () => {
    resetWrapperState();
    setWatchdogMonotonicNow(() => supervisionMonotonicNow());
    setSubAgentRunnerFactory(() => hangingRunner());

    await spawnSubAgent({
      type: 'explore',
      task: 'Visibility baseline',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-vis',
      category: 'research',
    });

    await waitForRunActive(FIXED_RUN_ID);

    now = 60_000;
    simulatePageVisibilityForTests('hidden');
    now = 120_000;
    simulatePageVisibilityForTests('visible');

    recordHeartbeat(FIXED_RUN_ID);
    bumpProgress(FIXED_RUN_ID);

    now = 125_000;
    tickWatchdog();
    await flushAsync();

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'running');
  });

  test('duplicate tool threshold 0 disables repetition detection', async () => {
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5_000 }));

    await spawnSubAgent({
      type: 'shell',
      task: 'No repetition guard',
      wait: false,
      parentChatId: PARENT_CHAT,
      parentTurnId: 'turn-watchdog-5',
      category: 'build',
    });

    setRepetitionThresholds({ duplicateToolCallThreshold: 0 });

    const args = { pattern: 'auth' };
    for (let i = 0; i < 8; i++) {
      recordToolCallForRun(FIXED_RUN_ID, 'grep', args);
    }
    await flushAsync();

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'running');
  });
});
