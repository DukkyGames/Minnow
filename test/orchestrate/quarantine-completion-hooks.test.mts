/**
 * Quarantine completion hooks — syncBoardRunCompletion via onTasksQuarantined.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import {
  resetOrchestratorAutoReportsForTests,
  setOrchestratorReportDeliverHook,
} from '../../src/agents/controller/report.ts';
import {
  maybeEmitOrchestratePlanComplete,
  resetOrchestratePlanCompleteUiForTests,
  setOrchestratePlanCompleteWrapUpHook,
} from '../../src/chat/orchestrate/plan-complete-ui.ts';
import {
  initBoard,
  quarantineTaskAndDependents,
  updateTask,
  waitForBoardCompletionHooksForTests,
} from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/quarantine-hooks.md';

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

describe('quarantine completion hooks', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
    resetOrchestratePlanCompleteUiForTests();
    setOrchestratePlanCompleteWrapUpHook(async () => {});
  });

  afterEach(async () => {
    await waitForBoardCompletionHooksForTests();
    resetOrchestratorAutoReportsForTests();
    resetOrchestratePlanCompleteUiForTests();
    setOrchestratePlanCompleteWrapUpHook(async () => {});
    resetSubAgentOrchestrator();
    await new Promise((resolve) => setImmediate(resolve));
    setSessionStateForTests(null);
  });

  test('all-quarantined via quarantineTaskAndDependents sets completionShownAt', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    updateTask(group, 'A', { status: 'quarantined' }, planner);

    quarantineTaskAndDependents(
      group,
      'B',
      { category: 'stall', summary: 'exhausted', resolutionSteps: [], at: 1 },
      planner,
    );

    await waitForBoardCompletionHooksForTests();

    assert.ok(board.completionShownAt != null, 'completionShownAt should be set');
    const completionMessages = planner.history.filter(
      (m) =>
        m.role === 'assistant' &&
        (String(m.content).includes('Orchestrate plan blocked') ||
          String(m.content).includes('Orchestrate plan complete')),
    );
    assert.equal(completionMessages.length, 1);
    setOrchestratorReportDeliverHook(null);
  });

  test('mixed complete+quarantine triggers final test pending via hook', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    board.executionMode = 'manual';
    updateTask(group, 'A', { status: 'complete' }, planner);

    quarantineTaskAndDependents(
      group,
      'B',
      { category: 'code', summary: 'bad code', resolutionSteps: [], at: 2 },
      planner,
    );

    await waitForBoardCompletionHooksForTests();

    assert.equal(
      board.finalTest?.status,
      'pending',
      `expected final test pending, got ${board.finalTest?.status ?? 'undefined'}`,
    );
    assert.equal(board.completionShownAt, undefined, 'completion should wait for final test');
  });
});

describe('requeue after completion round-trip', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
    resetOrchestratePlanCompleteUiForTests();
    setOrchestratePlanCompleteWrapUpHook(async () => {});
  });

  afterEach(async () => {
    await waitForBoardCompletionHooksForTests();
    resetOrchestratorAutoReportsForTests();
    resetOrchestratePlanCompleteUiForTests();
    setOrchestratePlanCompleteWrapUpHook(async () => {});
    resetSubAgentOrchestrator();
    await new Promise((resolve) => setImmediate(resolve));
    setSessionStateForTests(null);
  });

  test('requeue clears completionShownAt and allows second completion emit', async () => {
    const { group, planner } = seedTwoTaskBoard();
    const board = group.orchestrateBoard!;
    updateTask(group, 'A', { status: 'quarantined' }, planner);
    updateTask(group, 'B', { status: 'quarantined' }, planner);

    await maybeEmitOrchestratePlanComplete(group.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(board.completionShownAt != null);

    const { requeueBoardTask } = await import('../../src/state/orchestrate-board-actions.ts');
    await requeueBoardTask(group, 'A', planner);
    assert.equal(board.completionShownAt, undefined);

    updateTask(group, 'A', { status: 'complete' }, planner);
    updateTask(group, 'B', { status: 'complete' }, planner);
    board.finalTest = { status: 'passed', attempts: 1, lastRunAt: Date.now() };
    delete board.completionShownAt;

    const wrapUps: string[] = [];
    setOrchestratePlanCompleteWrapUpHook(async (_p, seed) => {
      wrapUps.push(seed);
    });

    await maybeEmitOrchestratePlanComplete(group.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(board.completionShownAt != null);
    assert.equal(wrapUps.length, 1);
  });
});
