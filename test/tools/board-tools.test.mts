/**
 * board_init / board_update_task / board_get_state validation + happy path.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { spawnSubAgent, resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import type { SubAgentRunner } from '../../src/agents/types.ts';
import {
  isDepsComplete,
  initBoard,
  isTaskReadyForAuto,
  setBoardNowForTests,
} from '../../src/state/orchestrate-board-store.ts';
import {
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  executeBoardTool,
  setBoardExecutorContext,
  validateBoardInitArgs,
  validateBoardUpdateTaskArgs,
} from '../../src/tools/board-tools.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const BOARD_GROUP_ID = '33333333-3333-3333-3333-333333333333';
const FIXED_NOW = 1710000001000;
const PLAN_PATH = 'documentation/plans/shiny-minsky-board-view.md';

const EXPECTED_BOARD_INIT_RESULT = `{
  "planPath": "documentation/plans/shiny-minsky-board-view.md",
  "tasks": [
    {
      "id": "W1-A",
      "title": "Implement board store",
      "wave": "W1",
      "category": "build",
      "status": "planned"
    }
  ],
  "waves": [
    {
      "id": "W1",
      "status": "planned",
      "taskCount": 1,
      "completeCount": 0
    }
  ],
  "startedAt": 1710000001000,
  "lastUpdatedAt": 1710000001000,
  "timerAccumulatedMs": 0,
  "maxConcurrentTasks": 3,
  "executionMode": "manual"
}`;

const EXPECTED_UPDATE_TASK_RESULT = `{
  "id": "W1-A",
  "title": "Implement board store",
  "wave": "W1",
  "category": "build",
  "status": "in_progress",
  "assignedRunId": "run-0001"
}`;

const EXPECTED_GET_STATE_RESULT = `{
  "planPath": "documentation/plans/shiny-minsky-board-view.md",
  "tasks": [
    {
      "id": "W1-A",
      "title": "Implement board store",
      "wave": "W1",
      "category": "build",
      "status": "in_progress",
      "assignedRunId": "run-0001"
    }
  ],
  "waves": [
    {
      "id": "W1",
      "status": "in_progress",
      "taskCount": 1,
      "completeCount": 0
    }
  ],
  "startedAt": 1710000001000,
  "lastUpdatedAt": 1710000001000,
  "timerAccumulatedMs": 0,
  "maxConcurrentTasks": 3,
  "executionMode": "manual"
}`;

function seedOrchestrateChat(overrides: Record<string, unknown> = {}) {
  setSessionStateForTests({
    version: 2,
    activeId: CHAT_ID,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    chats: [
      {
        id: CHAT_ID,
        name: 'Board Tools Test',
        workspacePath: '',
        modelId: 'test-model',
        modeId: 'orchestrate',
        orchestratePlanPath: PLAN_PATH,
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1710000000000,
        ...overrides,
      },
    ],
  });
}

function withBoardContext() {
  setBoardExecutorContext({ chatId: CHAT_ID });
}

describe('validateBoardInitArgs', () => {
  test('rejects duplicate task id', () => {
    const r = validateBoardInitArgs(
      {
        plan_path: PLAN_PATH,
        tasks: [
          { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
          { id: 'W1-A', title: 'B', wave: 'W1', category: 'test' },
        ],
        waves: [{ id: 'W1' }],
      },
      null,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, 'Error: duplicate task id');
  });

  test('rejects task referencing unknown wave', () => {
    const r = validateBoardInitArgs(
      {
        plan_path: PLAN_PATH,
        tasks: [{ id: 'W1-A', title: 'A', wave: 'W9', category: 'build' }],
        waves: [{ id: 'W1' }],
      },
      null,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, 'Error: task "W1-A" references unknown wave "W9"');
    }
  });

  test('accepts stringified tasks and waves arrays', () => {
    const r = validateBoardInitArgs(
      {
        plan_path: PLAN_PATH,
        tasks: JSON.stringify([
          { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        ]),
        waves: JSON.stringify([{ id: 'W1' }]),
      },
      null,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.args.tasks.length, 1);
      assert.equal(r.args.waves.length, 1);
    }
  });

  test('rejects plan_path mismatch with selected plan', () => {
    const r = validateBoardInitArgs(
      { plan_path: 'other/plan.md', tasks: [], waves: [{ id: 'W1' }] },
      {
        id: CHAT_ID,
        name: 'x',
        workspacePath: '',
        modelId: 'm',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
        orchestratePlanPath: PLAN_PATH,
      },
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.error.includes('plan_path must match selected plan'));
    }
  });
});

describe('validateBoardUpdateTaskArgs', () => {
  test('rejects invalid status', () => {
    const r = validateBoardUpdateTaskArgs({
      task_id: 'W1-A',
      status: 'done',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, 'Error: board_update_task requires valid "status"');
    }
  });

  test('rejects missing task_id', () => {
    const r = validateBoardUpdateTaskArgs({ status: 'complete' });
    assert.equal(r.ok, false);
  });
});

describe('executeBoardTool', () => {
  beforeEach(() => {
    setBoardNowForTests(() => FIXED_NOW);
    setSessionStateForTests(null);
    setBoardExecutorContext(null);
  });

  test('rejects when chat is not linked to an orchestrate board', async () => {
    seedOrchestrateChat({ modeId: 'build' });
    const out = await executeBoardTool(
      'board_get_state',
      {},
      { chatId: CHAT_ID },
    );
    assert.equal(out, 'Error: board tools require an active Orchestrate chat');
  });

  test('rejects board_init when chat is not orchestrate mode', async () => {
    seedOrchestrateChat({ modeId: 'build' });
    withBoardContext();
    const out = await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    assert.equal(out, 'Error: board tools require an active Orchestrate chat');
  });

  test('board_get_state accepts chatId without module executor context', async () => {
    seedOrchestrateChat();
    withBoardContext();
    await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Implement board store',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    });
    setBoardExecutorContext(null);
    const out = await executeBoardTool('board_get_state', {}, { chatId: CHAT_ID });
    assert.equal(out, EXPECTED_BOARD_INIT_RESULT);
  });

  test('board_get_state from linked build task chat', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: TASK_CHAT_ID,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      chats: [
        {
          id: CHAT_ID,
          name: 'Planner',
          workspacePath: '',
          modelId: 'test-model',
          modeId: 'orchestrate',
          orchestratePlanPath: PLAN_PATH,
          boardGroupId: BOARD_GROUP_ID,
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1710000000000,
        },
        {
          id: TASK_CHAT_ID,
          name: 'Task W1-A',
          workspacePath: '',
          modelId: 'test-model',
          modeId: 'build',
          boardGroupId: BOARD_GROUP_ID,
          boardTaskId: 'W1-A',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1710000000000,
        },
      ],
      groups: [
        {
          id: BOARD_GROUP_ID,
          name: 'Board',
          workspacePath: '',
          collapsed: false,
          order: 0,
          createdAt: 1,
          plannerChatId: CHAT_ID,
          orchestratePlanPath: PLAN_PATH,
        },
      ],
    });
    await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Implement board store',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    }, { chatId: CHAT_ID });

    const out = await executeBoardTool('board_get_state', {}, { chatId: TASK_CHAT_ID });
    assert.equal(out, EXPECTED_BOARD_INIT_RESULT);
  });

  test('board_update_task rejects calls from linked build task chat', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: TASK_CHAT_ID,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      chats: [
        {
          id: CHAT_ID,
          name: 'Planner',
          workspacePath: '',
          modelId: 'test-model',
          modeId: 'orchestrate',
          orchestratePlanPath: PLAN_PATH,
          boardGroupId: BOARD_GROUP_ID,
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1710000000000,
        },
        {
          id: TASK_CHAT_ID,
          name: 'Task W1-A',
          workspacePath: '',
          modelId: 'test-model',
          modeId: 'build',
          boardGroupId: BOARD_GROUP_ID,
          boardTaskId: 'W1-A',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1710000000000,
        },
      ],
      groups: [
        {
          id: BOARD_GROUP_ID,
          name: 'Board',
          workspacePath: '',
          collapsed: false,
          order: 0,
          createdAt: 1,
          plannerChatId: CHAT_ID,
          orchestratePlanPath: PLAN_PATH,
        },
      ],
    });
    await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Implement board store',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    }, { chatId: CHAT_ID });

    const out = await executeBoardTool(
      'board_update_task',
      { task_id: 'W1-A', status: 'complete' },
      { chatId: TASK_CHAT_ID },
    );
    assert.match(
      out,
      /Builders\/testers don't move cards/,
    );
  });

  test('board_init happy path returns static board JSON', async () => {
    seedOrchestrateChat();
    withBoardContext();
    const out = await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Implement board store',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    });
    assert.equal(out, EXPECTED_BOARD_INIT_RESULT);
  });

  test('board_update_task and board_get_state happy path', async () => {
    seedOrchestrateChat();
    withBoardContext();

    await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Implement board store',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    });

    const updateOut = await executeBoardTool('board_update_task', {
      task_id: 'W1-A',
      status: 'in_progress',
      run_id: 'run-0001',
    });
    assert.equal(updateOut, EXPECTED_UPDATE_TASK_RESULT);

    const getOut = await executeBoardTool('board_get_state', {});
    assert.equal(getOut, EXPECTED_GET_STATE_RESULT);
  });

  test('board_update_task before init returns error', async () => {
    seedOrchestrateChat();
    withBoardContext();
    const out = await executeBoardTool('board_update_task', {
      task_id: 'W1-A',
      status: 'complete',
    });
    assert.equal(out, 'Error: orchestrate board is not initialized');
  });

  test('board_get_state before init returns error', async () => {
    seedOrchestrateChat();
    withBoardContext();
    const out = await executeBoardTool('board_get_state', {});
    assert.equal(out, 'Error: orchestrate board is not initialized');
  });

  test('board_update_task rejects complete when linked run hit max tool turns', async () => {
    const FIXED_RUN_ID = '11111111-1111-1111-1111-111111111111';
    const exhaustingRunner: SubAgentRunner = {
      async run(input) {
        return {
          summary: `Sub-agent reached maximum tool turns (${input.maxToolTurns}).`,
          toolTurns: input.maxToolTurns,
          messages: [],
          toolTurnLimitExhausted: true,
        };
      },
    };

    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunnerFactory(() => exhaustingRunner);
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);

    seedOrchestrateChat();
    withBoardContext();

    await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Implement board store', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });

    await spawnSubAgent({
      type: 'explore',
      task: 'long work',
      wait: true,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-board-guard',
      modeId: 'orchestrate',
      boardTaskId: 'W1-A',
    });

    const denied = await executeBoardTool('board_update_task', {
      task_id: 'W1-A',
      status: 'complete',
    });
    assert.match(
      denied,
      /cannot mark task complete.*max tool turns/i,
    );

    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
  });
});

// ─── dependsOn validation ─────────────────────────────────────────────────

describe('validateBoardInitArgs — dependsOn', () => {
  const base = {
    plan_path: PLAN_PATH,
    waves: [{ id: 'W1' }, { id: 'W2' }],
  };

  test('accepts valid dependsOn referencing earlier task', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', dependsOn: ['W1-A'] },
      ],
    }, null);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.args.tasks[1]?.dependsOn, ['W1-A']);
    }
  });

  test('rejects self-dependency', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', dependsOn: ['W1-A'] },
      ],
    }, null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /depends on itself/);
  });

  test('rejects unknown dep id', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', dependsOn: ['W9-Z'] },
      ],
    }, null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /unknown task "W9-Z"/);
  });

  test('accepts snake_case depends_on field', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', depends_on: ['W1-A'] } as unknown as { id: string; title: string; wave: string; category: string },
      ],
    }, null);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.args.tasks[1]?.dependsOn, ['W1-A']);
  });

  test('accepts stringified dependsOn array', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', dependsOn: '["W1-A"]' } as unknown as { id: string; title: string; wave: string; category: string },
      ],
    }, null);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.args.tasks[1]?.dependsOn, ['W1-A']);
  });

  test('detects 2-node cycle', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', dependsOn: ['W1-B'] },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', dependsOn: ['W1-A'] },
      ],
    }, null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /cycle/i);
  });

  test('detects 3-node cycle', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', dependsOn: ['W1-C'] },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', dependsOn: ['W1-A'] },
        { id: 'W1-C', title: 'C', wave: 'W1', category: 'build', dependsOn: ['W1-B'] },
      ],
    }, null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /cycle/i);
  });

  test('omits dependsOn from output when empty', () => {
    const r = validateBoardInitArgs({
      ...base,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
    }, null);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.args.tasks[0]?.dependsOn, undefined);
  });
});

// ─── isDepsComplete ───────────────────────────────────────────────────────

describe('isDepsComplete', () => {
  function makeBoard(tasks: Array<{ id: string; status: string; dependsOn?: string[] }>): any {
    return {
      tasks: tasks.map((t) => ({ ...t, title: t.id, wave: 'W1', category: 'build' })),
      waves: [{ id: 'W1', status: 'planned', taskCount: tasks.length, completeCount: 0 }],
    };
  }

  test('returns true when no dependsOn', () => {
    const board = makeBoard([{ id: 'W1-A', status: 'planned' }]);
    assert.equal(isDepsComplete(board, board.tasks[0]), true);
  });

  test('returns true when all deps are complete', () => {
    const board = makeBoard([
      { id: 'W1-A', status: 'complete' },
      { id: 'W1-B', status: 'planned', dependsOn: ['W1-A'] },
    ]);
    assert.equal(isDepsComplete(board, board.tasks[1]), true);
  });

  test('returns false when dep is not complete', () => {
    const board = makeBoard([
      { id: 'W1-A', status: 'in_progress' },
      { id: 'W1-B', status: 'planned', dependsOn: ['W1-A'] },
    ]);
    assert.equal(isDepsComplete(board, board.tasks[1]), false);
  });

  test('skips unknown dep ids (does not block)', () => {
    const board = makeBoard([
      { id: 'W1-A', status: 'planned', dependsOn: ['X-UNKNOWN'] },
    ]);
    assert.equal(isDepsComplete(board, board.tasks[0]), true);
  });

  test('skips self-edges', () => {
    const board = makeBoard([{ id: 'W1-A', status: 'planned', dependsOn: ['W1-A'] }]);
    assert.equal(isDepsComplete(board, board.tasks[0]), true);
  });
});

// ─── isTaskReadyForAuto with deps ────────────────────────────────────────

describe('isTaskReadyForAuto with dependsOn', () => {
  test('blocks task until dep is complete', () => {
    const PLAN_PATH_LOCAL = 'docs/plans/test.md';
    const planner: Chat = {
      id: CHAT_ID,
      name: 'p',
      workspacePath: '',
      modelId: 'm',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
    };
    const group: ChatGroup = {
      id: BOARD_GROUP_ID,
      name: 'g',
      workspacePath: '',
      collapsed: false,
      order: 0,
      createdAt: 1,
    };
    initBoard(group, planner, {
      planPath: PLAN_PATH_LOCAL,
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build', dependsOn: ['W1-A'] },
      ],
    });
    const board = group.orchestrateBoard!;
    const taskA = board.tasks.find((t) => t.id === 'W1-A')!;
    const taskB = board.tasks.find((t) => t.id === 'W1-B')!;

    assert.equal(isTaskReadyForAuto(board, taskA), true);
    assert.equal(isTaskReadyForAuto(board, taskB), false);

    taskA.status = 'complete';
    assert.equal(isTaskReadyForAuto(board, taskB), true);
  });
});
