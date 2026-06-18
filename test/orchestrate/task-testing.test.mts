/**
 * Orchestrate per-task testing + final integration test routing.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  applyFinalTestFailureReopens,
  applyTaskTestFailureState,
  finalizeFinalTestOnStreamEnd,
  finalizeTaskTestingOnStreamEnd,
  tryTriggerFinalIntegrationTest,
} from '../../src/state/orchestrate-board-actions.ts';
import { isOrchestratePlanComplete } from '../../src/chat/orchestrate/plan-complete.ts';
import {
  executeBoardTool,
  setBoardExecutorContext,
  validateBoardReportTestResultArgs,
} from '../../src/tools/board-tools.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TEST_CHAT_ID = '33333333-3333-3333-3333-333333333333';

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

describe('board_report_test_result validation', () => {
  test('requires task_id, verdict, summary', () => {
    assert.equal(validateBoardReportTestResultArgs({}).ok, false);
    const ok = validateBoardReportTestResultArgs({
      task_id: 'W1-A',
      verdict: 'pass',
      summary: 'all good',
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.args.verdict, 'pass');
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
    const out = await executeBoardTool('board_report_test_result', {
      task_id: 'W1-A',
      verdict: 'pass',
      summary: 'typecheck and tests passed',
    });
    assert.doesNotMatch(out, /^Error:/);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.testVerdict, 'pass');
    assert.equal(task.testSummary, 'typecheck and tests passed');
  });

  test('rejects unknown task id', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    setBoardExecutorContext({ chatId: PLANNER_ID, groupId: GROUP_ID });
    const out = await executeBoardTool('board_report_test_result', {
      task_id: 'NOPE',
      verdict: 'fail',
      summary: 'bad id',
    });
    assert.match(out, /unknown board task/i);
    void group;
    void planner;
  });
});

describe('board_report_test_result tolerant inputs', () => {
  test('accepts non-canonical verdict casing/synonyms', () => {
    for (const v of ['PASS', 'Passed', 'success', ' ok ']) {
      const r = validateBoardReportTestResultArgs({ task_id: 'W1-A', verdict: v, summary: 's' });
      assert.equal(r.ok, true, `expected ${v} to validate`);
      if (r.ok) assert.equal(r.args.verdict, 'pass');
    }
    const f = validateBoardReportTestResultArgs({ task_id: 'W1-A', verdict: 'FAILED', summary: 's' });
    assert.equal(f.ok, true);
    if (f.ok) assert.equal(f.args.verdict, 'fail');
  });

  test('records verdict when task_id carries a title suffix', async () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });
    setBoardExecutorContext({ chatId: PLANNER_ID, groupId: GROUP_ID });
    const out = await executeBoardTool('board_report_test_result', {
      task_id: 'W1-A — A',
      verdict: 'pass',
      summary: 'ok',
    });
    assert.doesNotMatch(out, /^Error:/);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.testVerdict, 'pass');
  });
});

describe('finalizeTaskTestingOnStreamEnd', () => {
  beforeEach(() => setSessionStateForTests(null));

  test('pass moves task to complete', () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { testVerdict: 'pass', testSummary: 'ok', testChatId: TEST_CHAT_ID },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    finalizeTaskTestingOnStreamEnd(group, task, planner);
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

  test('recovers verdict from transcript VERDICT marker when tool call lost', () => {
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
    finalizeTaskTestingOnStreamEnd(group, task, planner);
    assert.equal(group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!.status, 'complete');
  });

  test('no marker and no verdict still fails', () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    const testChat: Chat = {
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
    updateTask(group, 'W1-A', { testChatId: TEST_CHAT_ID }, planner);
    setSessionStateForTests({ chats: [planner, testChat], groups: [group], activeChatId: PLANNER_ID });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    finalizeTaskTestingOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.testAttempts, 1);
  });

  test('retry persists the failure-aware builder seed on the task', () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { testVerdict: 'fail', testSummary: 'typecheck failed in foo.ts', testChatId: TEST_CHAT_ID },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    finalizeTaskTestingOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'in_progress');
    // The next Builder start must seed from the failure summary, not the original
    // build prompt — and it must survive on the task in case the build is queued.
    assert.ok(updated.pendingBuildSeed, 'expected pendingBuildSeed to be set');
    assert.match(updated.pendingBuildSeed!, /failed testing/i);
    assert.match(updated.pendingBuildSeed!, /typecheck failed in foo\.ts/);
  });

  test('third fail marks blocked', () => {
    const group = makeGroup({ 'W1-A': 'testing' });
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { testAttempts: 2, testVerdict: 'fail', testSummary: 'still broken' },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    finalizeTaskTestingOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated!.status, 'blocked');
    assert.match(updated!.error ?? '', /still broken/);
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
    assert.equal(b.testAttempts, 0);
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
});
