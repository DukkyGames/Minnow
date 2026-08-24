/**
 * Board builder progress survives transient turn failures (rollback guard + run-status outcome).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  repairSessionHistoryTail,
  rollbackFailedTurnHistory,
} from '../../src/chat/history.ts';
import {
  finalizeBoardTaskOnStreamEnd,
  resolveTaskChatStreamOutcome,
} from '../../src/state/orchestrate-board-actions.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup, TurnRunRecord } from '../../src/types.ts';

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

function makePartialBoardTaskChat(): Chat {
  return {
    id: TASK_CHAT_ID,
    name: 'Task W3-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Build Dashboard.tsx' },
      {
        role: 'assistant',
        content: 'Created client/src/components/Dashboard.tsx with charts.',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_orphan',
            type: 'function',
            function: { name: 'write_file', arguments: '{}' },
          },
        ],
      },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W3-A',
  };
}

function failedRunRecord(): TurnRunRecord {
  return {
    runId: 'run_11111111-1111-1111-1111-111111111111',
    branchId: 'branch_1',
    forkHistoryIndex: 0,
    status: 'failed',
    createdAt: 100,
    snapshot: {
      forkHistoryIndex: 0,
      userContent: 'Build',
      skillId: null,
      providerId: 'p',
      modelId: 'm1',
      temperature: 0.7,
      maxTokens: 4096,
      thinkingMode: 'off',
      modeId: 'build',
      workAgentId: null,
      workAgentAuto: false,
      composedSystemPrompt: '',
      enabledToolNames: [],
      maxToolTurns: 8,
      historyPrefixHash: 'abc',
    },
  };
}

function makeGroup(started = true): ChatGroup {
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
      tasks: [{ id: 'W3-A', title: 'Dashboard', wave: 'W3', category: 'build' }],
      waves: [{ id: 'W3', status: 'in_progress' }],
    },
  );
  updateTask(
    group,
    'W3-A',
    { status: 'in_progress', chatId: TASK_CHAT_ID, startedAt: 1 },
    planner,
  );
  group.orchestrateBoard!.maxConcurrentTasks = 3;
  group.orchestrateBoard!.autoRunning = started;
  setSessionStateForTests({
    chats: [planner, makePartialBoardTaskChat()],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return group;
}

describe('board task failed-turn history preservation', () => {
  afterEach(() => {
    resetAutopilotMetaCache();
    setSessionStateForTests(null);
  });

  test('repairSessionHistoryTail keeps completed assistant work on board chats', () => {
    const chat = makePartialBoardTaskChat();
    assert.equal(chat.history.length, 3);
    assert.equal(repairSessionHistoryTail(chat), true);
    assert.equal(chat.history.length, 2);
    assert.ok(
      chat.history.some(
        (m) =>
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.includes('Dashboard.tsx'),
      ),
    );
    assert.equal(chat.history[chat.history.length - 1]?.role, 'assistant');
    assert.ok(
      !('tool_calls' in (chat.history[chat.history.length - 1] ?? {})),
    );
  });

  test('rollbackFailedTurnHistory would discard partial board builder work', () => {
    const chat = makePartialBoardTaskChat();
    const ok = rollbackFailedTurnHistory(chat, 0);
    assert.equal(ok, true);
    assert.equal(chat.history.length, 1);
    assert.equal(chat.history[0]?.role, 'user');
  });

  test('resolveTaskChatStreamOutcome returns failed from run status despite partial assistant prose', () => {
    const chat = makePartialBoardTaskChat();
    chat.history = [
      { role: 'user', content: 'Build' },
      {
        role: 'assistant',
        content: 'Implemented WeightTracker.tsx and updated App.tsx.',
      },
    ];
    chat.runs = [failedRunRecord()];
    assert.equal(resolveTaskChatStreamOutcome(chat), 'failed');
  });
});

describe('finalizeBoardTaskOnStreamEnd in-place auto retry', () => {
  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2 });
  });

  afterEach(() => {
    delete process.env.MINNOW_TEST;
    resetAutopilotMetaCache();
    setSessionStateForTests(null);
  });

  test('auto retry keeps the same chat id and seeds next build with error context', () => {
    const group = makeGroup(true);
    const planner = makePlanner();
    const taskChat = makePartialBoardTaskChat();
    taskChat.history = [
      { role: 'user', content: 'Execute task' },
      // Non-stall failure so Phase 2 classifies as 'code' → applyTaskBuildFailureState path.
      { role: 'assistant', content: 'Build failed: TypeError: cannot read properties of undefined' },
    ];
    taskChat.runs = [failedRunRecord()];
    setSessionStateForTests({
      chats: [planner, taskChat],
      groups: [group],
      activeChatId: PLANNER_ID,
    });

    const task = group.orchestrateBoard!.tasks[0]!;
    const chatIdBefore = task.chatId;
    finalizeBoardTaskOnStreamEnd(group, task, planner);

    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.chatId, chatIdBefore);
    // Phase 2: runSelfHeal sets pendingBuildSeed with the build-retry prompt.
    assert.match(updated.pendingBuildSeed ?? '', /failed build attempt/i);
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.buildAttempts, 1);
  });

  test('context exceeded failed run retries in-place on same chat id', () => {
    const group = makeGroup(true);
    const planner = makePlanner();
    const taskChat = makePartialBoardTaskChat();
    taskChat.history = [
      { role: 'user', content: 'Execute task' },
      {
        role: 'assistant',
        content: 'Implemented Dashboard.tsx with charts before the provider cut off.',
      },
    ];
    const run = failedRunRecord();
    run.errorMessage =
      'Could not complete this reply: context length exceeded (n_ctx = 4096)';
    taskChat.runs = [run];
    setSessionStateForTests({
      chats: [planner, taskChat],
      groups: [group],
      activeChatId: PLANNER_ID,
    });

    const task = group.orchestrateBoard!.tasks[0]!;
    const chatIdBefore = task.chatId;
    finalizeBoardTaskOnStreamEnd(group, task, planner);

    const updated = group.orchestrateBoard!.tasks[0]!;
    assert.equal(updated.chatId, chatIdBefore);
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.buildAttempts, 1);
    assert.match(updated.pendingBuildSeed ?? '', /failed build attempt/i);
    assert.ok(
      taskChat.history.some(
        (m) =>
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.includes('Dashboard.tsx'),
      ),
      'partial builder work must survive context exceeded failure',
    );
  });
});
