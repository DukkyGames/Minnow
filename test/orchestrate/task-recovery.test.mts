/**
 * Orchestrate task recovery: restart / continue / move-to-new-chat (MIN-222).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { setAutopilotMetaForTests } from '../../src/config/autopilot-meta.ts';
import {
  buildContinueNudgeMessage,
  buildMoveToNewChatSeed,
  buildTaskProgressSummary,
  buildTaskSeedMessage,
  clearTaskFailureState,
  continueBoardTask,
  moveTaskToNewChat,
  restartBoardTask,
  shouldRouteContinueToNewChat,
} from '../../src/state/orchestrate-board-actions.ts';
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

function makeTaskChat(history: Chat['history'] = []): Chat {
  return {
    id: TASK_CHAT_ID,
    name: 'Task W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-A',
  };
}

function makeGroup(): ChatGroup {
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
      {
        id: 'W1-A',
        title: 'Init',
        wave: 'W1',
        category: 'build',
        build: 'Add feature X',
        test: 'Run unit tests',
      },
    ],
    waves: [{ id: 'W1', status: 'in_progress' }],
  });
  return group;
}

function seedSession(
  group: ChatGroup,
  taskPatch: Parameters<typeof updateTask>[2],
  taskChat?: Chat,
): { group: ChatGroup; planner: Chat; taskChat: Chat } {
  const planner = makePlanner();
  const chat = taskChat ?? makeTaskChat();
  updateTask(
    group,
    'W1-A',
    { status: 'in_progress', chatId: TASK_CHAT_ID, ...taskPatch },
    planner,
  );
  setSessionStateForTests({
    chats: [planner, chat],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return { group, planner, taskChat: chat };
}

describe('task recovery helpers', () => {
  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setSessionStateForTests(null);
    setAutopilotMetaForTests({ continueSmartRoute: 'conservative' });
  });

  test('buildContinueNudgeMessage references task id and title', () => {
    const group = makeGroup();
    const task = group.orchestrateBoard!.tasks[0]!;
    const msg = buildContinueNudgeMessage(task);
    assert.match(msg, /W1-A/);
    assert.match(msg, /Init/);
    assert.match(msg, /where you left off/i);
  });

  test('buildTaskProgressSummary includes excerpt and test summary', () => {
    const group = makeGroup();
    const task = group.orchestrateBoard!.tasks[0]!;
    const chat = makeTaskChat([
      { role: 'user', content: 'Execute task' },
      { role: 'assistant', content: 'Implemented feature X in src/foo.ts' },
    ]);
    updateTask(group, task.id, { testSummary: 'typecheck failed' }, makePlanner());
    const fresh = group.orchestrateBoard!.tasks[0]!;
    const summary = buildTaskProgressSummary(chat, fresh);
    assert.match(summary, /feature X/i);
    assert.match(summary, /typecheck failed/);
  });

  test('buildMoveToNewChatSeed includes summary and remaining specs', () => {
    const group = makeGroup();
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    const seed = buildMoveToNewChatSeed(group, planner, task, 'Did partial work');
    assert.match(seed, /Progress so far/);
    assert.match(seed, /Did partial work/);
    assert.match(seed, /Add feature X/);
    assert.match(seed, /Run unit tests/);
  });

  test('clearTaskFailureState snapshots prevFailure and clears fields', () => {
    const group = makeGroup();
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      {
        error: 'build failed',
        testVerdict: 'fail',
        testSummary: 'lint errors',
        testAttempts: 2,
      },
      planner,
    );
    const task = group.orchestrateBoard!.tasks[0]!;
    clearTaskFailureState(group, task, planner, { resetAttempts: true });
    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.error, undefined);
    assert.equal(updated.testVerdict, undefined);
    assert.equal(updated.testSummary, undefined);
    assert.equal(updated.testAttempts, undefined);
    assert.equal(updated.prevFailure?.error, 'build failed');
    assert.equal(updated.prevFailure?.testVerdict, 'fail');
    assert.equal(updated.prevFailure?.testSummary, 'lint errors');
    assert.ok(updated.prevFailure?.at);
  });

  test('shouldRouteContinueToNewChat: small chat stays on nudge path', () => {
    const group = makeGroup();
    const task = group.orchestrateBoard!.tasks[0]!;
    const chat = makeTaskChat([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'ok' },
    ]);
    assert.equal(shouldRouteContinueToNewChat(chat, task), false);
  });

  test('shouldRouteContinueToNewChat: derailed chat routes to new chat', () => {
    const group = makeGroup();
    const task = group.orchestrateBoard!.tasks[0]!;
    const chat = makeTaskChat([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'Maximum tool turns reached' },
    ]);
    assert.equal(shouldRouteContinueToNewChat(chat, task), true);
  });

  test('shouldRouteContinueToNewChat: off never routes', () => {
    setAutopilotMetaForTests({ continueSmartRoute: 'off' });
    const group = makeGroup();
    const task = group.orchestrateBoard!.tasks[0]!;
    const chat = makeTaskChat([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'Maximum tool turns reached' },
    ]);
    assert.equal(shouldRouteContinueToNewChat(chat, task), false);
  });
});

describe('task recovery actions', () => {
  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setSessionStateForTests(null);
    setAutopilotMetaForTests({ continueSmartRoute: 'conservative' });
  });

  test('restartBoardTask clears failure, resets attempts, sets original seed', async () => {
    const group = makeGroup();
    const { planner } = seedSession(group, {
      error: 'stuck',
      testVerdict: 'fail',
      testSummary: 'tests red',
      testAttempts: 2,
    });
    await restartBoardTask(group, 'W1-A', planner);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.error, undefined);
    assert.equal(task.testVerdict, undefined);
    assert.equal(task.testSummary, undefined);
    assert.equal(task.testAttempts, undefined);
    assert.equal(task.prevFailure?.testSummary, 'tests red');
    const expectedSeed = buildTaskSeedMessage(group, planner, task);
    assert.equal(task.pendingBuildSeed, expectedSeed);
    assert.match(task.pendingBuildSeed ?? '', /Execute this orchestrate task/);
  });

  test('continueBoardTask does not set pendingBuildSeed for small chat', async () => {
    const group = makeGroup();
    const chat = makeTaskChat([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'partial work' },
    ]);
    const { planner } = seedSession(
      group,
      {
        error: 'stopped mid-build',
        testAttempts: 1,
      },
      chat,
    );
    await continueBoardTask(group, 'W1-A', planner);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.pendingBuildSeed, undefined);
    assert.equal(task.error, undefined);
    assert.equal(task.testAttempts, 1);
    assert.equal(task.prevFailure?.error, 'stopped mid-build');
  });

  test('continueBoardTask routes bloated chat to summary seed', async () => {
    const group = makeGroup();
    const history: Chat['history'] = [{ role: 'user', content: 'go' }];
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'assistant', content: `turn ${i}` });
    }
    const { planner } = seedSession(group, { error: 'derailed' }, makeTaskChat(history));
    await continueBoardTask(group, 'W1-A', planner);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.ok(task.pendingBuildSeed);
    assert.match(task.pendingBuildSeed ?? '', /Continue this orchestrate task in a fresh chat/);
    assert.match(task.pendingBuildSeed ?? '', /Progress so far/);
  });

  test('moveTaskToNewChat sets summary seed and keeps testAttempts', async () => {
    const group = makeGroup();
    const chat = makeTaskChat([
      { role: 'user', content: 'start' },
      { role: 'assistant', content: 'edited files' },
    ]);
    const { planner } = seedSession(
      group,
      {
        testAttempts: 2,
        testVerdict: 'fail',
        testSummary: 'unit test failed',
      },
      chat,
    );
    await moveTaskToNewChat(group, 'W1-A', planner);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.testAttempts, 2);
    assert.equal(task.testVerdict, undefined);
    assert.equal(task.testSummary, undefined);
    assert.ok(task.pendingBuildSeed);
    assert.match(task.pendingBuildSeed ?? '', /edited files|Progress so far/);
    assert.equal(task.prevFailure?.testSummary, 'unit test failed');
  });
});
