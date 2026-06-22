/**
 * Merge-fixer recovery after reload: reconcile tasks stuck in `merging`.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  recoverInterruptedMergesAfterReload,
  releaseLaunchSlotForTests,
  reserveLaunchSlotForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const FIXER_CHAT_ID = '55555555-5555-5555-5555-555555555555';

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

function makeFixerChat(): Chat {
  return {
    id: FIXER_CHAT_ID,
    name: 'Merge fixer W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Resolve merge conflict' },
      { role: 'assistant', content: 'Conflict resolved and committed.' },
    ],
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

function seedMergingTask(
  group: ChatGroup,
  fixerChat: Chat,
): { group: ChatGroup; planner: Chat; fixerChat: Chat } {
  const planner = makePlanner();
  updateTask(
    group,
    'W1-A',
    {
      status: 'merging',
      fixerChatId: FIXER_CHAT_ID,
      worktreeBranch: 'minnow/board/W1-A',
      mergePreSha: 'abc123',
    },
    planner,
  );
  setSessionStateForTests({
    chats: [planner, fixerChat],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return { group, planner, fixerChat };
}

describe('merge fixer resume after reload', () => {
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setSessionStateForTests(null);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
  });

  afterEach(() => {
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('recoverInterruptedMergesAfterReload routes inactive fixer out of merging', async () => {
    const group = makeGroup();
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);

    await recoverInterruptedMergesAfterReload(group, planner);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.notEqual(task.status, 'merging');
  });

  test('recoverInterruptedMergesAfterReload leaves live fixer in merging', async () => {
    const group = makeGroup();
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);
    reserveLaunchSlotForTests(FIXER_CHAT_ID);

    await recoverInterruptedMergesAfterReload(group, planner);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.status, 'merging');
  });
});
