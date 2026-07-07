/**
 * Plan-complete UI: deterministic message + one wrap-up LLM turn.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  maybeEmitOrchestratePlanComplete,
  resetOrchestratePlanCompleteUiForTests,
  setOrchestratePlanCompleteWrapUpHook,
} from '../../src/chat/orchestrate/plan-complete-ui.ts';
import { setStreaming } from '../../src/app-state.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/plan-complete-ui.md';
const END = 2_000_000_000_000;

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
    name: 'Orchestrate folder',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
    plannerChatId: PLANNER_ID,
  };
}

function seedCompleteBoard(finalTestPassed = true) {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [
      { id: 'A', title: 'Alpha', wave: 'W1', category: 'build' },
    ],
  });
  const board = group.orchestrateBoard!;
  board.tasks[0]!.status = 'complete';
  board.startedAt = END - 60_000;
  board.lastUpdatedAt = END;
  if (finalTestPassed) {
    board.finalTest = { status: 'passed', attempts: 1, lastRunAt: END };
  }
  setSessionStateForTests({ version: 5, activeId: PLANNER_ID, chats: [planner], groups: [group] });
  return { planner, group, board };
}

describe('maybeEmitOrchestratePlanComplete wrap-up turn', () => {
  beforeEach(() => {
    resetOrchestratePlanCompleteUiForTests();
  });

  afterEach(() => {
    resetOrchestratePlanCompleteUiForTests();
    setStreaming(false, PLANNER_ID);
    setSessionStateForTests(null);
  });

  test('fires wrap-up exactly once and appends deterministic completion message', async () => {
    const { planner, group, board } = seedCompleteBoard();
    const wrapUps: string[] = [];
    setOrchestratePlanCompleteWrapUpHook(async (_planner, seed) => {
      wrapUps.push(seed);
    });

    await maybeEmitOrchestratePlanComplete(group.id);
    await new Promise((resolve) => setImmediate(resolve));
    await maybeEmitOrchestratePlanComplete(group.id);

    assert.equal(wrapUps.length, 1);
    assert.match(wrapUps[0]!, /final wrap-up/i);
    assert.match(wrapUps[0]!, /board_get_state/);
    assert.ok(board.completionShownAt != null);
    const completionMessages = planner.history.filter(
      (m) => m.role === 'assistant' && String(m.content).includes('Orchestrate plan complete'),
    );
    assert.equal(completionMessages.length, 1);
  });

  test('skips wrap-up turn when planner is streaming then retries on stream end', async () => {
    const { planner, group, board } = seedCompleteBoard();
    const wrapUps: string[] = [];
    setOrchestratePlanCompleteWrapUpHook(async (_planner, seed) => {
      wrapUps.push(seed);
    });
    setStreaming(true, PLANNER_ID);

    await maybeEmitOrchestratePlanComplete(group.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(wrapUps.length, 0);
    assert.equal(board.wrapUpPending, true);

    const { notifyChatStreamEnded } = await import('../../src/chat/streaming-state.ts');
    notifyChatStreamEnded(PLANNER_ID);
    setStreaming(false, PLANNER_ID);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(wrapUps.length, 1);
    assert.equal(board.wrapUpPending, false);
  });

  test('all-quarantined board still appends completion and fires wrap-up', async () => {
    const planner = makePlanner();
    const group = makeGroup();
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'Q', title: 'Blocked task', wave: 'W1', category: 'build' },
      ],
    });
    const board = group.orchestrateBoard!;
    board.tasks[0]!.status = 'quarantined';
    board.startedAt = END - 30_000;
    board.lastUpdatedAt = END;
    board.unresolvedIssues = [
      {
        taskId: 'Q',
        title: 'Blocked task',
        category: 'infra',
        summary: 'DB unavailable',
        resolutionSteps: ['start the database, then Requeue'],
        createdAt: END,
      },
    ];
    setSessionStateForTests({ version: 5, activeId: PLANNER_ID, chats: [planner], groups: [group] });

    const wrapUps: string[] = [];
    setOrchestratePlanCompleteWrapUpHook(async (_planner, seed) => {
      wrapUps.push(seed);
    });

    await maybeEmitOrchestratePlanComplete(group.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(wrapUps.length, 1);
    assert.match(wrapUps[0]!, /Quarantined/);
    assert.match(wrapUps[0]!, /DB unavailable/);
  });
});
