/**
 * board_report pipeline: happy path, quarantine-last stall, requeue re-announce,
 * and mid-turn report deferral while a task chat is streaming.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  deliverOrchestratorTaskReport,
  initOrchestratorAutoReports,
  resetOrchestratorAutoReportsForTests,
  setOrchestratorReportDeliverHook,
} from '../../src/agents/controller/report.ts';
import { setStreaming } from '../../src/app-state.ts';
import { resetOrchestratePlanCompleteUiForTests, setOrchestratePlanCompleteWrapUpHook } from '../../src/chat/orchestrate/plan-complete-ui.ts';
import { __testHooks, resetNotificationProducersForTests } from '../../src/notifications/producers.ts';
import { getNotifications, resetNotificationStoreForTests } from '../../src/notifications/store.ts';
import { requeueBoardTask } from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, quarantineTaskAndDependents, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { deriveBoardHeaderStatus } from '../../src/ui/orchestrate-board.ts';
import {
  executeBoardTool,
  setBoardExecutorContext,
  validateBoardReportArgs,
} from '../../src/tools/board-tools.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const BUILD_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const TEST_CHAT_ID = '33333333-3333-3333-3333-333333333333';
const PLAN_PATH = 'documentation/plans/board-report.md';

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
    orchestratePlanPath: PLAN_PATH,
    boardGroupId: GROUP_ID,
  };
}

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: PLAN_PATH,
    viewMode: 'board',
  };
}

function seedTwoTaskBoard() {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [
      { id: 'A', title: 'Task A', wave: 'W1', category: 'build', build: 'do a' },
      { id: 'B', title: 'Task B', wave: 'W1', category: 'build', build: 'do b' },
    ],
  });
  group.orchestrateBoard!.executionMode = 'auto';
  group.orchestrateBoard!.autoRunning = true;
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { group, planner };
}

describe('board_report happy path', () => {
  afterEach(() => {
    setBoardExecutorContext(null);
    setSessionStateForTests(null);
  });

  test('validates args and records structured report on the task', async () => {
    assert.equal(validateBoardReportArgs({}).ok, false);
    const { group, planner } = seedTwoTaskBoard();
    updateTask(group, 'A', { status: 'testing' }, planner);
    const testChat: Chat = {
      id: TEST_CHAT_ID,
      name: 'Tester',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'tester',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'A',
    };
    setSessionStateForTests({
      version: 5,
      activeId: TEST_CHAT_ID,
      chats: [planner, testChat],
      groups: [group],
    });
    setBoardExecutorContext({ chatId: TEST_CHAT_ID, groupId: GROUP_ID });
    const out = await executeBoardTool('board_report', {
      task_id: 'A',
      outcome: 'pass',
      summary: 'typecheck and tests passed',
    });
    assert.doesNotMatch(out, /^Error:/);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'A')!;
    assert.equal(task.boardReport?.outcome, 'pass');
    assert.equal(task.boardReport?.summary, 'typecheck and tests passed');
    assert.equal(task.testVerdict, 'pass');
  });
});

describe('quarantine-last stall', () => {
  beforeEach(() => {
    resetNotificationStoreForTests();
    resetNotificationProducersForTests();
    resetOrchestratePlanCompleteUiForTests();
    setOrchestratePlanCompleteWrapUpHook(async () => {});
  });

  afterEach(() => {
    resetNotificationStoreForTests();
    resetNotificationProducersForTests();
    resetOrchestratePlanCompleteUiForTests();
    setSessionStateForTests(null);
  });

  test('last active task quarantined via updateTask surfaces blocked terminal state', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    updateTask(group, 'A', { status: 'quarantined' }, planner);
    updateTask(group, 'B', { status: 'in_progress' }, planner);

    updateTask(
      group,
      'B',
      {
        status: 'quarantined',
        quarantine: {
          category: 'stall',
          summary: 'exhausted retries',
          resolutionSteps: ['inspect, then Requeue'],
          at: 1,
        },
      },
      planner,
    );

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(board.terminalBlocked, true);
    const status = deriveBoardHeaderStatus(board, false, 0, false);
    assert.equal(status.variant, 'quarantined');
    assert.match(status.label, /Blocked — 2 quarantined/);

    __testHooks.handleBoardChange(group.id);
    const blockedNotifs = getNotifications().filter((n) => n.kind === 'board_blocked');
    assert.equal(blockedNotifs.length, 1);
    assert.match(blockedNotifs[0]!.preview, /Blocked — 2 quarantined/);
  });

  test('quarantineTaskAndDependents on last active task emits completion', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    updateTask(group, 'A', { status: 'quarantined' }, planner);
    updateTask(group, 'B', { status: 'in_progress' }, planner);

    quarantineTaskAndDependents(
      group,
      'B',
      { category: 'code', summary: 'bad build', resolutionSteps: [], at: 2 },
      planner,
    );

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const { syncBoardRunCompletion } = await import('../../src/state/orchestrate-board-actions.ts');
    syncBoardRunCompletion(group, planner);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(board.terminalBlocked, true);
    assert.ok(board.completionShownAt != null);
    const completionMessages = planner.history.filter(
      (m) => m.role === 'assistant' && String(m.content).includes('Orchestrate plan blocked'),
    );
    assert.equal(completionMessages.length, 1);
  });
});

describe('requeue re-announce', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
  });

  afterEach(() => {
    resetOrchestratorAutoReportsForTests();
    setSessionStateForTests(null);
  });

  test('quarantine → requeue → complete delivers a fresh completion report', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    const task = board.tasks.find((t) => t.id === 'A')!;
    task.status = 'quarantined';
    task.quarantine = {
      category: 'stall',
      summary: 'stuck',
      resolutionSteps: [],
      at: 1,
    };

    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_id, msg) => {
      deliveries.push(msg);
    });

    await deliverOrchestratorTaskReport(group, planner, task, 'quarantined');
    const afterQuarantine = deliveries.length;
    assert.ok(afterQuarantine >= 1);

    await requeueBoardTask(group, 'A', planner);
    const refreshed = board.tasks.find((t) => t.id === 'A')!;
    refreshed.status = 'complete';
    refreshed.quarantine = undefined;
    refreshed.notes = 'Shipped on retry';

    await deliverOrchestratorTaskReport(group, planner, refreshed, 'complete');
    const completionReports = deliveries.filter((msg) => /completed/i.test(msg));
    assert.equal(completionReports.length, 1);
    assert.match(completionReports[0]!, /Shipped on retry|Task A/);
    assert.equal(refreshed.lifecycleRun, 1);
    setOrchestratorReportDeliverHook(null);
  });
});

describe('mid-turn report deferral', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
    initOrchestratorAutoReports();
  });

  afterEach(() => {
    resetOrchestratorAutoReportsForTests();
    setStreaming(false, PLANNER_ID);
    setStreaming(false, BUILD_CHAT_ID);
    setSessionStateForTests(null);
  });

  test('defers planner report while a board task chat is streaming', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    const task = board.tasks[0]!;
    task.status = 'failed';
    task.chatId = BUILD_CHAT_ID;
    const buildChat: Chat = {
      id: BUILD_CHAT_ID,
      name: 'Builder',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      workAgentId: 'builder',
      history: [{ role: 'assistant', content: 'still generating…' }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'A',
    };
    setSessionStateForTests({
      version: 5,
      activeId: BUILD_CHAT_ID,
      chats: [planner, buildChat],
      groups: [group],
    });

    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_id, msg) => {
      deliveries.push(msg);
    });

    setStreaming(true, BUILD_CHAT_ID);
    await deliverOrchestratorTaskReport(group, planner, task, 'failed');
    assert.equal(deliveries.length, 0, 'report should defer while task chat streams');

    const { notifyChatStreamEnded } = await import('../../src/chat/streaming-state.ts');
    setStreaming(false, BUILD_CHAT_ID);
    notifyChatStreamEnded(BUILD_CHAT_ID);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0]!, /failed/i);
    setOrchestratorReportDeliverHook(null);
  });
});
