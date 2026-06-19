/**
 * Boot resume for orchestrate boards after page reload.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { bootOrchestrateBoardResume } from '../../../src/chat/orchestrate/board-boot-resume.ts';
import { resumeBoardExecutionAfterReload } from '../../../src/state/orchestrate-board-actions.ts';
import { initBoard } from '../../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/boot-resume.md';

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
    name: 'Boot resume folder',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
    plannerChatId: PLANNER_ID,
  };
}

function seedRunningBoard(executionMode: 'auto' | 'sequential' = 'auto') {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Stalled task',
        wave: 'W1',
        category: 'build',
        build: 'Do work',
      },
    ],
  });
  const board = group.orchestrateBoard!;
  board.executionMode = executionMode;
  board.autoRunning = true;
  board.tasks[0]!.status = 'in_progress';
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { planner, group };
}

describe('boot orchestrate board resume', () => {
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
  });

  afterEach(() => {
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('resumeBoardExecutionAfterReload keeps board running for stalled in_progress task', async () => {
    const { planner, group } = seedRunningBoard('sequential');
    await resumeBoardExecutionAfterReload(group, planner);
    assert.equal(group.orchestrateBoard?.autoRunning, true);
    assert.equal(group.orchestrateBoard?.executionMode, 'sequential');
  });

  test('bootOrchestrateBoardResume skips boards that are not running', async () => {
    const { planner, group } = seedRunningBoard();
    group.orchestrateBoard!.autoRunning = false;
    await bootOrchestrateBoardResume({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    assert.equal(group.orchestrateBoard?.autoRunning, false);
  });

  test('bootOrchestrateBoardResume resumes each running board with a planner', async () => {
    const { planner, group } = seedRunningBoard();
    await bootOrchestrateBoardResume({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    assert.equal(group.orchestrateBoard?.autoRunning, true);
  });
});
