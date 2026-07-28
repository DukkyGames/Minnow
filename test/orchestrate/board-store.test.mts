/**
 * Orchestrate board store: wave rollup, progress %, event emission.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import {
  clearBoardListenersForTests,
  emitBoardChange,
  subscribeBoardChanges,
} from '../../src/state/orchestrate-board-events.ts';
import {
  applyOpenBoardWaveCollapse,
  countBoardTasksProgressed,
  countBoardWavesProgressed,
  getBoardExecutionMode,
  getBoardProgressPercent,
  getBoardState,
  initBoard,
  isBoardAutoMode,
  isBoardRunning,
  isTaskReadyForAuto,
  recomputeWaveRollup,
  rollupWaveStatus,
  setBoardNowForTests,
  resetBoardLogForTests,
  updateTask,
} from '../../src/state/orchestrate-board-store.ts';
import { flushScheduledSessionSaveForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

afterEach(() => {
  flushScheduledSessionSaveForTests();
  resetSubAgentOrchestrator();
});

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const FIXED_NOW = 1710000001000;
const PLAN_PATH = 'documentation/plans/shiny-minsky-board-view.md';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Board Store Test',
    workspacePath: '',
    modelId: 'test-model',
    modeId: 'orchestrate',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1710000000000,
    ...overrides,
  };
}

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Board Store Test',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: 1710000000000,
  };
}

/** Static snapshot after init with one planned task on W1. */
const EXPECTED_INIT_BOARD_JSON = `{
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
  "executionMode": "manual",
  "modelId": "test-model",
  "log": [
    {
      "type": "board_init",
      "level": "info",
      "message": "Board initialized (1 tasks, 1 waves)",
      "detail": {
        "summary": "1 tasks, 1 waves"
      },
      "ts": 1710000001000,
      "id": "1710000001000-0"
    }
  ]
}`;

/** After W1-A moves to in_progress — wave rollup stays in_progress. */
const EXPECTED_WAVE_IN_PROGRESS_JSON = `{
  "id": "W1",
  "status": "in_progress",
  "taskCount": 1,
  "completeCount": 0
}`;

/** After W1-A completes — wave and progress hit 100%. */
const EXPECTED_WAVE_COMPLETE_JSON = `{
  "id": "W1",
  "status": "complete",
  "taskCount": 1,
  "completeCount": 1
}`;

describe('orchestrate board store rollup', () => {
  beforeEach(() => {
    setBoardNowForTests(() => FIXED_NOW);
    resetBoardLogForTests();
    clearBoardListenersForTests();
  });

  test('rollupWaveStatus: planned, in_progress, complete', () => {
    const tasks = [
      {
        id: 'W1-A',
        title: 'A',
        wave: 'W1',
        category: 'build' as const,
        status: 'planned' as const,
      },
    ];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'planned');

    tasks[0].status = 'in_progress';
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'in_progress');

    tasks[0].status = 'complete';
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'complete');
  });

  test('failed task keeps wave in_progress', () => {
    const tasks = [
      {
        id: 'W1-A',
        title: 'A',
        wave: 'W1',
        category: 'build' as const,
        status: 'failed' as const,
      },
    ];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'in_progress');
  });
});

describe('orchestrate board store init and progress', () => {
  beforeEach(() => {
    setBoardNowForTests(() => FIXED_NOW);
    resetBoardLogForTests();
    clearBoardListenersForTests();
  });

  test('initBoard matches static JSON and progress 0%', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
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
    const board = getBoardState(group);
    assert.ok(board);
    assert.equal(JSON.stringify(board, null, 2), EXPECTED_INIT_BOARD_JSON);
    assert.equal(getBoardProgressPercent(board!), 0);
    assert.equal(countBoardTasksProgressed(board!), 0);
    assert.equal(countBoardWavesProgressed(board!), 0);
  });

  test('header progress counts include in_progress tasks and waves', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build' },
        { id: 'W2-A', title: 'C', wave: 'W2', category: 'build' },
      ],
      waves: [{ id: 'W1' }, { id: 'W2' }],
    });
    const board = getBoardState(group)!;
    updateTask(group, 'W1-A', { status: 'in_progress' }, chat);
    updateTask(group, 'W1-B', { status: 'in_progress' }, chat);
    assert.equal(countBoardTasksProgressed(board), 2);
    assert.equal(countBoardWavesProgressed(board), 1);
    updateTask(group, 'W1-A', { status: 'complete' }, chat);
    assert.equal(countBoardTasksProgressed(board), 2);
    assert.equal(countBoardWavesProgressed(board), 1);
  });

  test('updateTask clears error when patch sets error to undefined', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
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

    updateTask(group, 'W1-A', {
      status: 'failed',
      error: 'Upstream HTTP 500 - model returned malformed tool call.',
    });
    updateTask(group, 'W1-A', { status: 'planned', error: undefined });

    const task = getBoardState(group)!.tasks[0];
    assert.equal(task.status, 'planned');
    assert.equal(task.error, undefined);
    assert.equal('error' in task, false);
  });

  test('updateTask rolls wave to in_progress then complete; progress 0→100', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
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

    updateTask(group, 'W1-A', { status: 'in_progress' });
    let board = getBoardState(group)!;
    assert.equal(getBoardProgressPercent(board), 0);
    assert.equal(
      JSON.stringify(board.waves[0], null, 2),
      EXPECTED_WAVE_IN_PROGRESS_JSON,
    );

    updateTask(group, 'W1-A', { status: 'complete' });
    board = getBoardState(group)!;
    assert.equal(getBoardProgressPercent(board), 100);
    assert.equal(JSON.stringify(board.waves[0], null, 2), EXPECTED_WAVE_COMPLETE_JSON);
  });

  test('recomputeWaveRollup: complete + planned wave stays planned; progress 50%', () => {
    const board: OrchestrateBoardState = {
      planPath: PLAN_PATH,
      startedAt: FIXED_NOW,
      lastUpdatedAt: FIXED_NOW,
      tasks: [
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'complete',
        },
        {
          id: 'W1-B',
          title: 'B',
          wave: 'W1',
          category: 'test',
          status: 'planned',
        },
      ],
      waves: [{ id: 'W1', status: 'planned' }],
    };
    recomputeWaveRollup(board);
    assert.equal(getBoardProgressPercent(board), 50);
    assert.equal(board.waves[0].status, 'planned');
    assert.equal(board.waves[0].taskCount, 2);
    assert.equal(board.waves[0].completeCount, 1);
  });

  test('recomputeWaveRollup: complete + in_progress wave is in_progress', () => {
    const board: OrchestrateBoardState = {
      planPath: PLAN_PATH,
      startedAt: FIXED_NOW,
      lastUpdatedAt: FIXED_NOW,
      tasks: [
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'complete',
        },
        {
          id: 'W1-B',
          title: 'B',
          wave: 'W1',
          category: 'test',
          status: 'in_progress',
        },
      ],
      waves: [{ id: 'W1', status: 'planned' }],
    };
    recomputeWaveRollup(board);
    assert.equal(getBoardProgressPercent(board), 50);
    assert.equal(board.waves[0].status, 'in_progress');
    assert.equal(board.waves[0].taskCount, 2);
    assert.equal(board.waves[0].completeCount, 1);
  });

  test('applyOpenBoardWaveCollapse keeps only waves with in_progress tasks expanded', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Planned', wave: 'W1', category: 'build' },
        { id: 'W2-A', title: 'Active', wave: 'W2', category: 'build' },
        { id: 'W3-A', title: 'Testing', wave: 'W3', category: 'test' },
      ],
      waves: [{ id: 'W1' }, { id: 'W2' }, { id: 'W3' }],
    });
    updateTask(group, 'W2-A', { status: 'in_progress' });
    updateTask(group, 'W3-A', { status: 'testing' });
    group.orchestrateBoard!.waves[1].collapsed = false;
    group.orchestrateBoard!.waves[2].collapsed = false;

    applyOpenBoardWaveCollapse(group);

    const waves = group.orchestrateBoard!.waves;
    assert.equal(waves[0].collapsed, true);
    assert.equal(waves[1].collapsed, false);
    assert.equal(waves[2].collapsed, true);
  });
});

describe('orchestrate board store events', () => {
  beforeEach(() => {
    setBoardNowForTests(() => FIXED_NOW);
    resetBoardLogForTests();
    clearBoardListenersForTests();
  });

  test('initBoard and updateTask emit board change for group id', () => {
    const chat = makeChat();
    const group = makeGroup();
    const seen: string[] = [];
    subscribeBoardChanges(GROUP_ID, (id) => {
      seen.push(id);
    });

    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'testing' });

    assert.deepEqual(seen, [GROUP_ID, GROUP_ID]);
  });

  test('emitBoardChange notifies subscribers', () => {
    const seen: string[] = [];
    subscribeBoardChanges(GROUP_ID, (id) => seen.push(id));
    emitBoardChange(GROUP_ID);
    assert.deepEqual(seen, [GROUP_ID]);
  });
});

describe('orchestrate board dependency cycles', () => {
  beforeEach(() => {
    setBoardNowForTests(() => FIXED_NOW);
    resetBoardLogForTests();
    clearBoardListenersForTests();
  });

  test('initBoard marks cyclic dependsOn tasks blocked with cycle error', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Task A',
          wave: 'W1',
          category: 'build',
          dependsOn: ['W1-B'],
        },
        {
          id: 'W1-B',
          title: 'Task B',
          wave: 'W1',
          category: 'build',
          dependsOn: ['W1-A'],
        },
      ],
      waves: [{ id: 'W1' }],
    });
    const board = getBoardState(group)!;
    const taskA = board.tasks.find((t) => t.id === 'W1-A')!;
    const taskB = board.tasks.find((t) => t.id === 'W1-B')!;
    assert.equal(taskA.status, 'blocked');
    assert.equal(taskB.status, 'blocked');
    assert.match(taskA.error ?? '', /dependency cycle:/);
    assert.match(taskB.error ?? '', /dependency cycle:/);
    assert.equal(board.waves[0]?.status, 'in_progress');
    assert.equal(isTaskReadyForAuto(board, taskA), false);
    assert.equal(isTaskReadyForAuto(board, taskB), false);
  });
});

describe('isTaskReadyForAuto DAG-first scheduling', () => {
  test('task with satisfied deps is ready even when a same-wave sibling is incomplete', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build' },
        { id: 'W1-C', title: 'C', wave: 'W1', category: 'build', dependsOn: ['W1-A'] },
      ],
      waves: [{ id: 'W1' }],
    });
    const board = getBoardState(group)!;
    const taskA = board.tasks.find((t) => t.id === 'W1-A')!;
    const taskB = board.tasks.find((t) => t.id === 'W1-B')!;
    const taskC = board.tasks.find((t) => t.id === 'W1-C')!;

    taskA.status = 'complete';
    assert.equal(isTaskReadyForAuto(board, taskC), true);
    assert.equal(isTaskReadyForAuto(board, taskB), true);
    taskB.status = 'in_progress';
    assert.equal(isTaskReadyForAuto(board, taskC), true);
  });

  test('task without dependsOn still respects prior wave barrier', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W2-A', title: 'B', wave: 'W2', category: 'build' },
      ],
      waves: [{ id: 'W1' }, { id: 'W2' }],
    });
    const board = getBoardState(group)!;
    const w2 = board.tasks.find((t) => t.id === 'W2-A')!;
    assert.equal(isTaskReadyForAuto(board, w2), false);
    board.tasks.find((t) => t.id === 'W1-A')!.status = 'complete';
    assert.equal(isTaskReadyForAuto(board, w2), true);
  });
});

describe('execution mode afk', () => {
  test('getBoardExecutionMode returns afk when set', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard!.executionMode = 'afk';
    assert.equal(getBoardExecutionMode(group.orchestrateBoard), 'afk');
  });

  test('isBoardAutoMode and isBoardRunning recognise afk', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard!.executionMode = 'afk';
    assert.equal(isBoardAutoMode(group), true);
    assert.equal(isBoardRunning(group), false);
    group.orchestrateBoard!.autoRunning = true;
    assert.equal(isBoardRunning(group), true);
  });
});
