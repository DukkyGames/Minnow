/**
 * Orchestrate board store: wave rollup, progress %, event emission.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  clearBoardListenersForTests,
  emitBoardChange,
  subscribeBoardChanges,
} from '../../src/state/orchestrate-board-events.ts';
import {
  getBoardProgressPercent,
  getBoardState,
  initBoard,
  recomputeWaveRollup,
  rollupWaveStatus,
  setBoardNowForTests,
  updateTask,
} from '../../src/state/orchestrate-board-store.ts';
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
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
  "lastUpdatedAt": 1710000001000
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
    clearBoardListenersForTests();
  });

  test('initBoard matches static JSON and progress 0%', () => {
    const chat = makeChat();
    initBoard(chat, {
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
    const board = getBoardState(chat);
    assert.ok(board);
    assert.equal(JSON.stringify(board, null, 2), EXPECTED_INIT_BOARD_JSON);
    assert.equal(getBoardProgressPercent(board!), 0);
  });

  test('updateTask rolls wave to in_progress then complete; progress 0→100', () => {
    const chat = makeChat();
    initBoard(chat, {
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

    updateTask(chat, 'W1-A', { status: 'in_progress' });
    let board = getBoardState(chat)!;
    assert.equal(getBoardProgressPercent(board), 0);
    assert.equal(
      JSON.stringify(board.waves[0], null, 2),
      EXPECTED_WAVE_IN_PROGRESS_JSON,
    );

    updateTask(chat, 'W1-A', { status: 'complete' });
    board = getBoardState(chat)!;
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
});

describe('orchestrate board store events', () => {
  beforeEach(() => {
    setBoardNowForTests(() => FIXED_NOW);
    clearBoardListenersForTests();
  });

  test('initBoard and updateTask emit board change for chat id', () => {
    const chat = makeChat();
    const seen: string[] = [];
    subscribeBoardChanges(CHAT_ID, (id) => {
      seen.push(id);
    });

    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'testing' });

    assert.deepEqual(seen, [CHAT_ID, CHAT_ID]);
  });

  test('emitBoardChange notifies subscribers', () => {
    const seen: string[] = [];
    subscribeBoardChanges(CHAT_ID, (id) => seen.push(id));
    emitBoardChange(CHAT_ID);
    assert.deepEqual(seen, [CHAT_ID]);
  });
});
