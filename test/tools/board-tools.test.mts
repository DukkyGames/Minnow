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
import { setBoardNowForTests } from '../../src/state/orchestrate-board-store.ts';
import {
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  executeBoardTool,
  setBoardExecutorContext,
  validateBoardInitArgs,
  validateBoardUpdateTaskArgs,
} from '../../src/tools/board-tools.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
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
  "lastUpdatedAt": 1710000001000
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
  "lastUpdatedAt": 1710000001000
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

  test('rejects when chat is not orchestrate mode', async () => {
    seedOrchestrateChat({ modeId: 'build' });
    withBoardContext();
    const out = await executeBoardTool('board_init', {
      plan_path: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    assert.equal(out, 'Error: board tools require an active Orchestrate chat');
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
