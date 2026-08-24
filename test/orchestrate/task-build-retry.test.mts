/**
 * Build-failure retry bookkeeping for auto/afk orchestrate boards.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  applyTaskBuildFailureState,
  buildBuildRetrySeedMessage,
  clearTaskFailureState,
  finalizeBoardTaskOnStreamEnd,
} from '../../src/state/orchestrate-board-actions.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';

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

function makeFailedTaskChat(): Chat {
  return {
    id: TASK_CHAT_ID,
    name: 'Task W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Execute task' },
      // Non-stall failure: Phase 2 classifies as 'code' → applyTaskBuildFailureState path.
      { role: 'assistant', content: 'Build failed: TypeError: undefined is not a function in main.ts' },
    ],
    // Failed run so resolveTaskChatStreamOutcome returns 'failed' (prose alone returns 'completed').
    runs: [{ runId: 'run_1', branchId: 'b1', forkHistoryIndex: 0, status: 'failed', createdAt: 100, snapshot: null } as any],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-A',
  };
}

function makeGroup(shape: 'stopped' | 'auto' | 'afk' = 'auto'): ChatGroup {
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
  initBoard(
    group,
    planner,
    {
      planPath: 'documentation/plans/test.md',
      tasks: [{ id: 'W1-A', title: 'Init', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1', status: 'in_progress' }],
    },
  );
  updateTask(
    group,
    'W1-A',
    { status: 'in_progress', chatId: TASK_CHAT_ID, startedAt: 1 },
    planner,
  );
  group.orchestrateBoard!.maxConcurrentTasks = shape === 'stopped' ? 1 : 3;
  if (shape === 'afk') group.orchestrateBoard!.handsOff = true;
  group.orchestrateBoard!.autoRunning = shape !== 'stopped';
  setSessionStateForTests({
    chats: [planner, makeFailedTaskChat()],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return group;
}

describe('applyTaskBuildFailureState', () => {
  afterEach(() => {
    resetAutopilotMetaCache();
    setSessionStateForTests(null);
  });

  test('returns retry below maxBuildAttempts', () => {
    setAutopilotMetaForTests({ maxBuildAttempts: 2 });
    const group = makeGroup('afk');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    const route = applyTaskBuildFailureState(group, task, planner, 'build blew up');
    assert.equal(route, 'retry');
    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.buildAttempts, 1);
    assert.equal(updated.status, 'in_progress');
  });

  test('returns failed at cap', () => {
    setAutopilotMetaForTests({ maxBuildAttempts: 2 });
    const group = makeGroup('afk');
    const planner = makePlanner();
    updateTask(group, 'W1-A', { buildAttempts: 1 }, planner);
    const task = group.orchestrateBoard!.tasks[0]!;
    const route = applyTaskBuildFailureState(group, task, planner, 'still broken');
    assert.equal(route, 'failed');
    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.buildAttempts, 2);
    assert.equal(updated.status, 'failed');
  });
});

describe('buildBuildRetrySeedMessage', () => {
  afterEach(() => resetAutopilotMetaCache());

  test('includes attempt fraction and error summary', () => {
    setAutopilotMetaForTests({ maxBuildAttempts: 2 });
    const msg = buildBuildRetrySeedMessage(
      { id: 'W1-A', title: 'API', wave: 1, category: 'build', status: 'in_progress' },
      1,
      'EADDRINUSE',
    );
    assert.match(msg, /failed build attempt/i);
    assert.match(msg, /W1-A/);
    assert.match(msg, /1\/2/);
    assert.match(msg, /EADDRINUSE/);
  });
});

describe('clearTaskFailureState', () => {
  afterEach(() => setSessionStateForTests(null));

  test('resetAttempts clears buildAttempts', () => {
    const group = makeGroup('stopped');
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { buildAttempts: 2, error: 'failed', status: 'failed' },
      planner,
    );
    const task = group.orchestrateBoard!.tasks[0]!;
    clearTaskFailureState(group, task, planner, { resetAttempts: true });
    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.buildAttempts, undefined);
  });
});

describe('finalizeBoardTaskOnStreamEnd build retry', () => {
  beforeEach(() => {
    setSessionStateForTests(null);
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2 });
  });

  afterEach(() => {
    resetAutopilotMetaCache();
    setSessionStateForTests(null);
  });

  test('auto mode retries failed build below cap', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    const chatIdBefore = task.chatId;
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.buildAttempts, 1);
    assert.equal(updated.chatId, chatIdBefore);
    // Phase 2: runSelfHeal sets pendingBuildSeed with the build-retry prompt before re-starting.
    assert.match(updated.pendingBuildSeed ?? '', /failed build attempt/i);
  });

  test('manual mode marks failed without retry', () => {
    const group = makeGroup('stopped');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.status, 'failed');
    assert.equal(updated.buildAttempts, undefined);
  });
});
