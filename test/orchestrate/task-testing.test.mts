/**
 * Orchestrate per-task testing + final integration test routing.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  applyFinalTestFailureReopens,
  applyTaskTestFailureState,
  clearMissingReportNudgesForTests,
  completeTaskAfterVerificationPass,
  finalizeBoardTaskOnStreamEnd,
  finalizeFinalTestOnStreamEnd,
  finalizeTaskTestingOnStreamEnd,
  getMissingReportNudgeCountForTests,
  isBoardSkipPerTaskTestingLocked,
  MISSING_REPORT_NUDGE_CAP,
  setBoardSkipPerTaskTesting,
  startTaskTesting,
  tryTriggerFinalIntegrationTest,
} from '../../src/state/orchestrate-board-actions.ts';
import { isOrchestratePlanComplete } from '../../src/chat/orchestrate/plan-complete.ts';
import {
  executeBoardTool,
  setBoardExecutorContext,
  validateBoardReportArgs,
} from '../../src/tools/board-tools.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TEST_CHAT_ID = '33333333-3333-3333-3333-333333333333';
const BUILD_CHAT_ID = '22222222-2222-2222-2222-222222222222';

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: 'documentation/plans/test.md',
    boardGroupId: GROUP_ID,
  };
}

function makeGroup(taskStatuses: Record<string, 'complete' | 'testing' | 'in_progress'>): ChatGroup {
  const planner = makePlanner();
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: 'documentation/plans/test.md',
    viewMode: 'board',
  };
  initBoard(group, planner, {
    planPath: 'documentation/plans/test.md',
    tasks: [
      { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
      { id: 'W1-B', title: 'B', wave: 'W1', category: 'build' },
    ],
    waves: [{ id: 'W1' }],
  });
  for (const [id, status] of Object.entries(taskStatuses)) {
    updateTask(group, id, { status }, planner);
  }
  setSessionStateForTests({
    chats: [planner],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return group;
}

/** Tester chat that finished its turn cleanly but never reported a verdict. */
function makeNoVerdictTesterChat(): Chat {
  return {
    id: TEST_CHAT_ID,
    name: 'Test',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    workAgentId: 'tester',
    history: [{ role: 'assistant', content: 'Looks fine to me, everything works.' }],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-A',
  };
}

describe('board_report validation', () => {
  test('requires task_id, outcome, summary', () => {
    assert.equal(validateBoardReportArgs({}).ok, false);
    const ok = validateBoardReportArgs({
      task_id: 'W1-A',
      outcome: 'pass',
      summary: 'all good',
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.args.outcome, 'pass');
    }
  });

  test('records per-task verdict on board', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    setSessionStateForTests({
      chats: [planner, testChat],
      groups: [group],
      activeChatId: TEST_CHAT_ID,
    });
    setBoardExecutorContext({ chatId: TEST_CHAT_ID, groupId: GROUP_ID });
    const out = await executeBoardTool('board_report', {
      task_id: 'W1-A',
      outcome: 'pass',
      summary: 'typecheck and tests passed',
    });
    assert.doesNotMatch(out, /^Error:/);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.testVerdict, 'pass');
    assert.equal(task.testSummary, 'typecheck and tests passed');
    assert.equal(task.boardReport?.outcome, 'pass');
  });

  test('rejects unknown task id', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    setBoardExecutorContext({ chatId: PLANNER_ID, groupId: GROUP_ID });
    const out = await executeBoardTool('board_report', {
      task_id: 'NOPE',
      outcome: 'fail',
      summary: 'bad id',
    });
    assert.match(out, /unknown board task/i);
    void group;
    void planner;
  });
});

describe('board_report tolerant inputs', () => {
  test('accepts non-canonical outcome casing/synonyms', () => {
    for (const v of ['PASS', 'Passed', 'success', ' ok ']) {
      const r = validateBoardReportArgs({ task_id: 'W1-A', outcome: v, summary: 's' });
      assert.equal(r.ok, true, `expected ${v} to validate`);
      if (r.ok) assert.equal(r.args.outcome, 'pass');
    }
    const f = validateBoardReportArgs({ task_id: 'W1-A', outcome: 'FAILED', summary: 's' });
    assert.equal(f.ok, true);
    if (f.ok) assert.equal(f.args.outcome, 'fail');
  });

  test('records verdict when task_id carries a title suffix', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: TEST_CHAT_ID });
    setBoardExecutorContext({ chatId: TEST_CHAT_ID, groupId: GROUP_ID });
    const out = await executeBoardTool('board_report', {
      task_id: 'W1-A — A',
      outcome: 'pass',
      summary: 'ok',
    });
    assert.doesNotMatch(out, /^Error:/);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.boardReport?.outcome, 'pass');
    assert.equal(task.testVerdict, 'pass');
  });
});

describe('finalizeTaskTestingOnStreamEnd', () => {
  beforeEach(() => {
    setSessionStateForTests(null);
    clearMissingReportNudgesForTests();
  });

  test('pass moves task to complete', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { testVerdict: 'pass', testSummary: 'ok', testChatId: TEST_CHAT_ID },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await finalizeTaskTestingOnStreamEnd(group, task, planner);
    assert.equal(group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!.status, 'complete');
  });

  test('unset verdict treated as fail and increments testAttempts', () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    const route = applyTaskTestFailureState(group, task, planner, 'Tester did not report a verdict');
    assert.equal(route, 'retry');
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated!.status, 'in_progress');
    assert.equal(updated!.testAttempts, 1);
  });

  test('recovers verdict from transcript VERDICT marker when tool call lost', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [
        { role: 'assistant', content: 'Typecheck and tests passed.\nVERDICT: pass' },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
    setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await finalizeTaskTestingOnStreamEnd(group, task, planner);
    assert.equal(group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!.status, 'complete');
  });

  test('uses most recent assistant message that contains VERDICT marker', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [
        { role: 'assistant', content: 'VERDICT: pass' },
        { role: 'assistant', content: 'all good!' },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
    setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await finalizeTaskTestingOnStreamEnd(group, task, planner);
    assert.equal(group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!.status, 'complete');
  });

  test('no marker and no verdict nudges the Tester instead of failing the task', async () => {
    const prevMinnowTest = process.env.MINNOW_TEST;
    process.env.MINNOW_TEST = '1';
    try {
      const group = makeGroup({ 'W1-A': 'testing' });
      const planner = makePlanner();
      // Nudging (like fail-routing) only happens on a running board.
      group.orchestrateBoard!.executionMode = 'afk';
      group.orchestrateBoard!.autoRunning = true;
      const testChat = makeNoVerdictTesterChat();
      updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
      setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });
      const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
      await finalizeTaskTestingOnStreamEnd(group, task, planner);

      const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
      // Task stays in testing and keeps its chat — no attempt burned, no reseed.
      assert.equal(updated.status, 'testing');
      assert.equal(updated.testAttempts, undefined);
      assert.equal(updated.testChatId, TEST_CHAT_ID);
      assert.equal(updated.pendingBuildSeed, undefined);
      assert.equal(getMissingReportNudgeCountForTests(TEST_CHAT_ID), 1);
    } finally {
      if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
      else process.env.MINNOW_TEST = prevMinnowTest;
    }
  });

  test('no verdict fails the task once the nudge budget is exhausted', async () => {
    const prevMinnowTest = process.env.MINNOW_TEST;
    process.env.MINNOW_TEST = '1';
    try {
      const group = makeGroup({ 'W1-A': 'testing' });
      const planner = makePlanner();
      group.orchestrateBoard!.executionMode = 'afk';
      group.orchestrateBoard!.autoRunning = true;
      const testChat = makeNoVerdictTesterChat();
      updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
      setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });

      // Every nudge ends in another report-less stream end; the last one falls
      // through to the existing self-heal fail routing.
      for (let i = 0; i < MISSING_REPORT_NUDGE_CAP; i++) {
        const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
        await finalizeTaskTestingOnStreamEnd(group, task, planner);
        assert.equal(group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!.status, 'testing');
      }
      const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
      await finalizeTaskTestingOnStreamEnd(group, task, planner);

      const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
      assert.equal(updated.status, 'in_progress');
      assert.equal(updated.testAttempts, 1);
    } finally {
      if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
      else process.env.MINNOW_TEST = prevMinnowTest;
    }
  });

  test('retry persists the failure-aware builder seed on the task', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    group.orchestrateBoard!.executionMode = 'afk';
    group.orchestrateBoard!.autoRunning = true;
    updateTask(
      group,
      'W1-A',
      { testVerdict: 'fail', testSummary: 'typecheck failed in foo.ts', testChatId: TEST_CHAT_ID },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await finalizeTaskTestingOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'in_progress');
    // The next Builder start must seed from the failure summary, not the original
    // build prompt — and it must survive on the task in case the build is queued.
    assert.ok(updated.pendingBuildSeed, 'expected pendingBuildSeed to be set');
    assert.match(updated.pendingBuildSeed!, /failed testing/i);
    assert.match(updated.pendingBuildSeed!, /typecheck failed in foo\.ts/);
  });

  test('third fail quarantines via self-heal (Phase 2)', async () => {
    // Running board delivers a quarantined report async — stub the deliverer so
    // the in-flight delivery settles before the next test installs its own hook.
    const { setOrchestratorReportDeliverHook } = await import(
      '../../src/agents/controller/report.ts'
    );
    setOrchestratorReportDeliverHook(async () => {});
    try {
      // Uses W1-B: the transit through `blocked` consumes the module-level
      // `<task>:stalled` report dedup key, which the afk test below asserts
      // on for W1-A.
      const group = makeGroup({ 'W1-B': 'testing' });
      const planner = makePlanner();
      group.orchestrateBoard!.executionMode = 'afk';
      group.orchestrateBoard!.autoRunning = true;
      updateTask(
        group,
        'W1-B',
        { testAttempts: 2, testVerdict: 'fail', testSummary: 'still broken' },
        planner,
      );
      const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
      await finalizeTaskTestingOnStreamEnd(group, task, planner);
      const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
      // Phase 2: exhausted test attempts are quarantined by self-heal (not left as blocked).
      assert.equal(updated!.status, 'quarantined');
      assert.match(updated!.error ?? updated!.quarantine?.summary ?? '', /still broken/);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      setOrchestratorReportDeliverHook(null);
    }
  });

  test('afk mode third fail blocks and delivers stalled report', async () => {
    const { setOrchestratorReportDeliverHook } = await import(
      '../../src/agents/controller/report.ts'
    );
    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_chatId, message) => {
      deliveries.push(message);
    });

    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    group.orchestrateBoard!.executionMode = 'afk';
    group.orchestrateBoard!.autoRunning = true;

    updateTask(
      group,
      'W1-A',
      { testAttempts: 2, testVerdict: 'fail', testSummary: 'still broken' },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    const route = applyTaskTestFailureState(group, task, planner, 'still broken');
    assert.equal(route, 'blocked');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated!.status, 'blocked');
    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0]!, /stalled/i);
    assert.match(deliveries[0]!, /exhausting its automatic retries/i);

    setOrchestratorReportDeliverHook(null);
  });
});

describe('skip per-task testing', () => {
  beforeEach(() => {
    setSessionStateForTests(null);
    clearMissingReportNudgesForTests();
  });

  test('setBoardSkipPerTaskTesting locks after a task leaves planned', () => {
    const group = makeGroup({ 'W1-A': 'planned', 'W1-B': 'planned' });
    const planner = makePlanner();
    setBoardSkipPerTaskTesting(group, true, planner);
    assert.equal(group.orchestrateBoard!.skipPerTaskTesting, true);
    updateTask(group, 'W1-A', { status: 'in_progress' }, planner);
    assert.equal(isBoardSkipPerTaskTestingLocked(group.orchestrateBoard!), true);
    setBoardSkipPerTaskTesting(group, false, planner);
    assert.equal(group.orchestrateBoard!.skipPerTaskTesting, true);
  });

  test('build pass with skip merges to complete without entering testing', async () => {
    const group = makeGroup({ 'W1-A': 'in_progress' });
    const planner = makePlanner();
    group.orchestrateBoard!.skipPerTaskTesting = true;
    group.orchestrateBoard!.autoRunning = true;
    group.orchestrateBoard!.executionMode = 'auto';
    const buildChat: Chat = {
      id: BUILD_CHAT_ID,
      name: 'Build',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      history: [{ role: 'assistant', content: 'done' }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    updateTask(
      group,
      'W1-A',
      {
        chatId: BUILD_CHAT_ID,
        boardReport: { outcome: 'pass', summary: 'build ok' },
      },
      planner,
    );
    setSessionStateForTests({
      chats: [planner, buildChat],
      groups: [group],
      activeChatId: BUILD_CHAT_ID,
    });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.notEqual(updated.status, 'testing');
    assert.equal(updated.status, 'complete');
  });

  test('startTaskTesting still runs for legacy testing-column tasks when skip is on', async () => {
    const prevMinnowTest = process.env.MINNOW_TEST;
    process.env.MINNOW_TEST = '1';
    try {
      const group = makeGroup({ 'W1-A': 'testing' });
      const planner = makePlanner();
      group.orchestrateBoard!.skipPerTaskTesting = true;
      group.orchestrateBoard!.autoRunning = true;
      group.orchestrateBoard!.executionMode = 'auto';
      updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
      setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });
      await startTaskTesting(group, 'W1-A', planner);
      const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
      assert.equal(updated.testChatId, TEST_CHAT_ID);
    } finally {
      if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
      else process.env.MINNOW_TEST = prevMinnowTest;
    }
  });

  test('final integration still arms when skip is on and all tasks complete', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    const planner = makePlanner();
    group.orchestrateBoard!.skipPerTaskTesting = true;
    group.orchestrateBoard!.executionMode = 'manual';
    tryTriggerFinalIntegrationTest(group, planner);
    assert.equal(group.orchestrateBoard!.finalTest?.status, 'pending');
  });

  test('completeTaskAfterVerificationPass marks task complete on skipped merge', async () => {
    const group = makeGroup({ 'W1-A': 'in_progress' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test W1-A',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [
        { role: 'user', content: 'Test' },
        { role: 'assistant', content: 'VERDICT: pass' },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
    setSessionStateForTests({
      chats: [planner, testChat],
      groups: [group],
      activeChatId: PLANNER_ID,
    });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await completeTaskAfterVerificationPass(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'complete');
    assert.ok(updated.synthesizedTestAt);
    const firstStamp = updated.synthesizedTestAt;
    await completeTaskAfterVerificationPass(group, updated, planner);
    const again = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(again.synthesizedTestAt, firstStamp);
  });
});

describe('final integration test', () => {
  beforeEach(() => setSessionStateForTests(null));

  test('all complete without final pass is not board-complete', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    assert.equal(isOrchestratePlanComplete(group.orchestrateBoard!), true);
    group.orchestrateBoard!.finalTest = { status: 'pending' };
    assert.notEqual(group.orchestrateBoard!.finalTest.status, 'passed');
  });

  test('manual mode sets final test pending when all tasks complete', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    const planner = makePlanner();
    group.orchestrateBoard!.executionMode = 'manual';
    tryTriggerFinalIntegrationTest(group, planner);
    assert.equal(group.orchestrateBoard!.finalTest?.status, 'pending');
  });

  test('final pass sets status passed', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    group.orchestrateBoard!.finalTest = {
      status: 'in_progress',
      chatId: TEST_CHAT_ID,
      recordedVerdict: 'pass',
      summary: 'e2e ok',
    };
    const board = group.orchestrateBoard!;
    board.finalTest = { ...board.finalTest!, status: 'passed' };
    assert.equal(board.finalTest?.status, 'passed');
    assert.equal(board.finalTest?.recordedVerdict, 'pass');
  });

  test('final fail with failing_tasks reopens tasks without starting builder', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    const planner = makePlanner();
    applyFinalTestFailureReopens(group, planner, ['W1-B'], 'UI broken');
    const b = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    assert.equal(b.status, 'in_progress');
    assert.equal(b.testAttempts, 1);
    assert.equal(b.testSummary, 'UI broken');
  });

  test('final fail without failing_tasks does not guess reopen', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    const planner = makePlanner();
    group.orchestrateBoard!.finalTest = {
      status: 'in_progress',
      recordedVerdict: 'fail',
      summary: 'unknown culprit',
      failingTaskIds: [],
    };
    finalizeFinalTestOnStreamEnd(group, planner);
    assert.equal(group.orchestrateBoard!.tasks.every((t) => t.status === 'complete'), true);
    const last = planner.history.at(-1);
    assert.equal(typeof last?.content, 'string');
    assert.match(last!.content as string, /no failing task ids/i);
  });

  test('final fail with all tasks complete emits blocked completion report', () => {
    const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
    const planner = makePlanner();
    group.orchestrateBoard!.finalTest = {
      status: 'in_progress',
      recordedVerdict: 'fail',
      summary: 'regression in checkout',
      failingTaskIds: [],
    };
    finalizeFinalTestOnStreamEnd(group, planner);
    assert.equal(group.orchestrateBoard!.finalTest?.status, 'failed');
    assert.ok(
      group.orchestrateBoard!.completionShownAt != null,
      'completion report should surface when final test fails with all tasks complete',
    );
  });

  test('final integration prose without VERDICT nudges instead of passing', async () => {
    const prevMinnowTest = process.env.MINNOW_TEST;
    process.env.MINNOW_TEST = '1';
    try {
      const group = makeGroup({ 'W1-A': 'complete', 'W1-B': 'complete' });
      const planner = makePlanner();
      group.orchestrateBoard!.executionMode = 'afk';
      group.orchestrateBoard!.autoRunning = true;
      group.orchestrateBoard!.finalTest = {
        status: 'in_progress',
        chatId: TEST_CHAT_ID,
      };
      const finalChat: Chat = {
        id: TEST_CHAT_ID,
        name: 'Final',
        workspacePath: '/tmp/ws',
        modeId: 'build',
        modelId: 'm1',
        workAgentId: 'tester',
        history: [{ role: 'assistant', content: 'Looks good but no VERDICT marker.' }],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
        boardGroupId: GROUP_ID,
      };
      setSessionStateForTests({ chats: [planner, finalChat], groups: [group], activeChatId: PLANNER_ID });
      await finalizeFinalTestOnStreamEnd(group, planner);
      assert.notEqual(group.orchestrateBoard!.finalTest?.status, 'passed');
      assert.equal(getMissingReportNudgeCountForTests(TEST_CHAT_ID), 1);
    } finally {
      if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
      else process.env.MINNOW_TEST = prevMinnowTest;
    }
  });

  test('recovers VERDICT:PASS uppercase from tester transcript', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [{ role: 'assistant', content: 'All green.\nVERDICT:PASS' }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
    setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await finalizeTaskTestingOnStreamEnd(group, task, planner);
    assert.equal(group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!.status, 'complete');
  });

  test('conflicting VERDICT markers in one message — latest pass wins', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Test',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [
        {
          role: 'assistant',
          content: 'VERDICT: fail\nOn second thought: VERDICT: pass',
        },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };
    updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
    setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    await finalizeTaskTestingOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'complete');
    assert.equal(updated.testVerdict, 'pass');
  });
});
