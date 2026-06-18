/**
 * Board task status advances when a linked task chat stream ends.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  finalizeBoardTaskOnStreamEnd,
  resolveTaskChatStreamOutcome,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, isTaskStalledForRestart, markBoardTaskInProgressFromChat, updateTask } from '../../src/state/orchestrate-board-store.ts';
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
  });

  test('resolveTaskChatStreamOutcome: completed vs stopped', () => {
    assert.equal(resolveTaskChatStreamOutcome(makeTaskChat(false)), 'completed');
    assert.equal(resolveTaskChatStreamOutcome(makeTaskChat(true)), 'stopped');
  });

  test('auto mode marks successful task complete', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
    const task = group.orchestrateBoard!.tasks[0]!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'complete');
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

  test('failed outcome marks task failed in auto mode', () => {
    const group = makeGroup('auto');
    const planner = makePlanner();
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
