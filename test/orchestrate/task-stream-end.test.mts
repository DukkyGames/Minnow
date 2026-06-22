/**
 * Board task status advances when a linked task chat stream ends.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test, afterEach } from 'node:test';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import {
  clearTaskQueuesForTests,
  countRunningTaskChats,
  drainTaskQueueForTests,
  enqueueTaskForTests,
  finalizeBoardTaskOnStreamEnd,
  getTaskQueueForTests,
  releaseLaunchSlotForTests,
  reserveLaunchSlotForTests,
  resolveTaskChatStreamOutcome,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, isTaskStalledForRestart, markBoardTaskInProgressFromChat, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const TEST_CHAT_ID = '44444444-4444-4444-4444-444444444444';
const TASK_B_CHAT_ID = '33333333-3333-3333-3333-333333333333';

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

function makeTaskChat(stopped = false): Chat {
  return {
    id: TASK_CHAT_ID,
    name: 'Task W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Execute task' },
      {
        role: 'assistant',
        content: stopped ? 'Partial work…' : 'Task finished successfully.',
        ...(stopped ? { stopped: true } : {}),
      },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-A',
  };
}

function makeGroup(executionMode: 'manual' | 'auto' = 'manual'): ChatGroup {
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
      tasks: [
        {
          id: 'W1-A',
          title: 'Init',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1', status: 'in_progress' }],
    },
  );
  updateTask(
    group,
    'W1-A',
    { status: 'in_progress', chatId: TASK_CHAT_ID, startedAt: 1 },
    planner,
  );
  group.orchestrateBoard!.executionMode = executionMode;
  if (executionMode === 'auto') {
    group.orchestrateBoard!.autoRunning = true;
  }
  const taskChat = makeTaskChat();
  setSessionStateForTests({
    chats: [planner, taskChat],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return group;
}

describe('task stream end finalization', () => {
  beforeEach(() => {
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    releaseLaunchSlotForTests(TEST_CHAT_ID);
    releaseLaunchSlotForTests(TASK_CHAT_ID);
    releaseLaunchSlotForTests(TASK_B_CHAT_ID);
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 1 });
  });

  afterEach(() => {
    resetAutopilotMetaCache();
  });

  test('resolveTaskChatStreamOutcome: completed vs stopped', () => {
    assert.equal(resolveTaskChatStreamOutcome(makeTaskChat(false)), 'completed');
    assert.equal(resolveTaskChatStreamOutcome(makeTaskChat(true)), 'stopped');
  });

  test('auto mode moves successful build to testing (Tester launched separately)', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'testing');
    assert.ok(updated.endedAt);
  });

  test('manual mode moves successful task to testing', () => {
    const group = makeGroup('manual');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'testing');
    assert.ok(updated.endedAt);
  });

  test('stopped task stays in_progress', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    const taskChat = makeTaskChat(true);
    setSessionStateForTests({
      chats: [planner, taskChat],
      groups: [group],
      activeChatId: PLANNER_ID,
    });
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'in_progress');
    assert.ok(updated.endedAt);
  });

  test('failed outcome marks task failed in auto mode at build retry cap', () => {
    setAutopilotMetaForTests({ maxBuildAttempts: 1 });
    const group = makeGroup('auto');
    const planner = makePlanner();
    updateTask(group, 'W1-A', { buildAttempts: 1 }, planner);
    const task = group.orchestrateBoard!.tasks[0]!;
    const failedChat: Chat = {
      ...makeTaskChat(false),
      history: [
        { role: 'user', content: 'Execute task' },
        {
          role: 'assistant',
          content: 'Maximum tool turns reached.',
        },
      ],
    };
    setSessionStateForTests({
      chats: [planner, failedChat],
      groups: [group],
      activeChatId: PLANNER_ID,
    });
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'failed');
    assert.match(updated.error ?? '', /without completing/i);
  });

  test('markBoardTaskInProgressFromChat sets in_progress when stream starts', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    updateTask(group, 'W1-A', { status: 'planned', chatId: TASK_CHAT_ID }, planner);
    const taskChat = makeTaskChat();
    taskChat.history = [];
    markBoardTaskInProgressFromChat(taskChat);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'in_progress');
    assert.ok(updated.startedAt);
  });

  test('markBoardTaskInProgressFromChat leaves testing status for Tester chats', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { status: 'testing', chatId: TASK_CHAT_ID, testChatId: '44444444-4444-4444-4444-444444444444' },
      planner,
    );
    const testChat: Chat = {
      ...makeTaskChat(),
      id: '44444444-4444-4444-4444-444444444444',
      workAgentId: 'tester',
      boardTaskId: 'W1-A',
    };
    markBoardTaskInProgressFromChat(testChat);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'testing');
  });

  test('isTaskStalledForRestart uses testChatId during testing', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { status: 'testing', chatId: TASK_CHAT_ID, testChatId: '44444444-4444-4444-4444-444444444444' },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(
      isTaskStalledForRestart(group.orchestrateBoard!, task, (id) => id === task.testChatId),
      false,
    );
    assert.equal(
      isTaskStalledForRestart(group.orchestrateBoard!, task, () => false),
      true,
    );
  });

  test('isTaskStalledForRestart detects idle in_progress task', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { status: 'in_progress', chatId: TASK_CHAT_ID },
      planner,
    );
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(
      isTaskStalledForRestart(group.orchestrateBoard!, task, () => false),
      true,
    );
    assert.equal(
      isTaskStalledForRestart(group.orchestrateBoard!, task, () => true),
      false,
    );
  });
});

describe('build→test handoff slot accounting', () => {
  beforeEach(() => {
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    releaseLaunchSlotForTests(TEST_CHAT_ID);
    releaseLaunchSlotForTests(TASK_CHAT_ID);
    releaseLaunchSlotForTests(TASK_B_CHAT_ID);
  });

  test('reservation counts as a concurrency slot', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    updateTask(
      group,
      'W1-A',
      { status: 'testing', chatId: TASK_CHAT_ID, testChatId: TEST_CHAT_ID },
      planner,
    );
    const board = group.orchestrateBoard!;
    assert.equal(countRunningTaskChats(board), 0);
    reserveLaunchSlotForTests(TEST_CHAT_ID);
    assert.equal(countRunningTaskChats(board), 1);
    releaseLaunchSlotForTests(TEST_CHAT_ID);
    assert.equal(countRunningTaskChats(board), 0);
  });

  test('handoff reservation keeps board at cap across microtask re-drain', async () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const board = group.orchestrateBoard!;
    board.maxConcurrentTasks = 2;
    board.tasks.push({
      id: 'W1-B',
      title: 'Second',
      wave: 'W1',
      category: 'build',
      status: 'in_progress',
      chatId: TASK_B_CHAT_ID,
    });
    updateTask(
      group,
      'W1-A',
      { status: 'testing', chatId: TASK_CHAT_ID, testChatId: TEST_CHAT_ID },
      planner,
    );
    reserveLaunchSlotForTests(TASK_B_CHAT_ID);
    reserveLaunchSlotForTests(TEST_CHAT_ID);
    assert.equal(countRunningTaskChats(board), 2);

    board.tasks.push({
      id: 'W1-C',
      title: 'Queued',
      wave: 'W1',
      category: 'build',
      status: 'planned',
    });
    enqueueTaskForTests(GROUP_ID, 'W1-C');

    await drainTaskQueueForTests(group, planner);
    assert.equal(countRunningTaskChats(board), 2);
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-C']);

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await drainTaskQueueForTests(group, planner);
    assert.equal(countRunningTaskChats(board), 2);
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-C']);
  });

  test('slot release after handoff re-drains stranded tester queue item', async () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const board = group.orchestrateBoard!;
    board.maxConcurrentTasks = 1;
    updateTask(
      group,
      'W1-A',
      { status: 'testing', chatId: TASK_CHAT_ID, testChatId: TEST_CHAT_ID },
      planner,
    );
    // Build chat still holds its launch slot when stream-end enqueues the tester.
    reserveLaunchSlotForTests(TASK_CHAT_ID);
    assert.equal(countRunningTaskChats(board), 1);

    enqueueTaskForTests(GROUP_ID, 'W1-A');

    await drainTaskQueueForTests(group, planner);
    assert.equal(countRunningTaskChats(board), 1);
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-A']);

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await drainTaskQueueForTests(group, planner);
    assert.equal(countRunningTaskChats(board), 1);
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-A']);

    releaseLaunchSlotForTests(TASK_CHAT_ID);
    await drainTaskQueueForTests(group, planner);
    assert.equal(countRunningTaskChats(board), 0);
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), []);
  });

  test('drainTaskQueue promotes in-testing tasks ahead of queued builds in auto mode', async () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const board = group.orchestrateBoard!;
    board.maxConcurrentTasks = 2;
    board.tasks.push({
      id: 'W1-B',
      title: 'Running build',
      wave: 'W1',
      category: 'build',
      status: 'in_progress',
      chatId: TASK_B_CHAT_ID,
    });
    board.tasks.push({
      id: 'W1-C',
      title: 'Queued build',
      wave: 'W1',
      category: 'build',
      status: 'planned',
    });
    updateTask(
      group,
      'W1-A',
      { status: 'testing', chatId: TASK_CHAT_ID, testChatId: TEST_CHAT_ID },
      planner,
    );
    reserveLaunchSlotForTests(TASK_B_CHAT_ID);
    reserveLaunchSlotForTests(TEST_CHAT_ID);
    assert.equal(countRunningTaskChats(board), 2);

    enqueueTaskForTests(GROUP_ID, 'W1-C');
    enqueueTaskForTests(GROUP_ID, 'W1-A');

    await drainTaskQueueForTests(group, planner);
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-A', 'W1-C']);
  });
});
