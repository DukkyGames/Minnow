/**
 * Board diagnostic log: append order, ring buffer cap, moveTaskStatus emission.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { moveTaskStatus } from '../../src/state/orchestrate-board-actions.ts';
import { clearBoardListenersForTests } from '../../src/state/orchestrate-board-events.ts';
import {
  appendBoardLog,
  BOARD_LOG_MAX,
  initBoard,
  resetBoardLogForTests,
  setBoardLogDiskSink,
  setBoardNowForTests,
} from '../../src/state/orchestrate-board-store.ts';
import { flushScheduledSessionSaveForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const FIXED_NOW = 1710000001000;
const PLAN_PATH = 'documentation/plans/board-log-fixture.md';

function makeChat(): Chat {
  return {
    id: CHAT_ID,
    name: 'Board Log Test',
    workspacePath: '',
    modelId: 'test-model',
    modeId: 'orchestrate',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_NOW,
  };
}

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Board Log Test',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: FIXED_NOW,
  };
}

beforeEach(() => {
  setBoardNowForTests(() => FIXED_NOW);
  resetBoardLogForTests();
  setBoardLogDiskSink(undefined);
});

afterEach(() => {
  setBoardNowForTests(null);
  resetBoardLogForTests();
  setBoardLogDiskSink(undefined);
  clearBoardListenersForTests();
  flushScheduledSessionSaveForTests();
});

describe('appendBoardLog', () => {
  test('assigns deterministic id/ts and preserves append order', () => {
    const group = makeGroup();
    const chat = makeChat();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    const board = group.orchestrateBoard!;
    board.log = [];
    resetBoardLogForTests();

    appendBoardLog(group, { type: 'auto_start', level: 'info', message: 'first' });
    appendBoardLog(group, { type: 'auto_stop', level: 'info', message: 'second' });

    assert.deepEqual(
      board.log?.map((e) => ({ id: e.id, ts: e.ts, message: e.message })),
      [
        { id: `${FIXED_NOW}-0`, ts: FIXED_NOW, message: 'first' },
        { id: `${FIXED_NOW}-1`, ts: FIXED_NOW, message: 'second' },
      ],
    );
  });

  test('drops oldest rows when exceeding BOARD_LOG_MAX', () => {
    const group = makeGroup();
    const chat = makeChat();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    const board = group.orchestrateBoard!;
    board.log = [];

    for (let i = 0; i < BOARD_LOG_MAX + 5; i++) {
      appendBoardLog(group, {
        type: 'tool_call',
        level: 'info',
        message: `row-${i}`,
        taskId: 'W1-A',
      });
    }

    assert.equal(board.log?.length, BOARD_LOG_MAX);
    assert.equal(board.log?.[0]?.message, 'row-5');
    assert.equal(board.log?.at(-1)?.message, `row-${BOARD_LOG_MAX + 4}`);
  });

  test('invokes disk sink when configured', () => {
    const group = makeGroup();
    const chat = makeChat();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard!.log = [];

    const seen: Array<{ groupId: string; message: string }> = [];
    setBoardLogDiskSink((groupId, event) => {
      seen.push({ groupId, message: event.message });
    });

    appendBoardLog(group, { type: 'auto_start', level: 'info', message: 'mirrored' });
    assert.deepEqual(seen, [{ groupId: GROUP_ID, message: 'mirrored' }]);
  });
});

describe('moveTaskStatus logging', () => {
  test('emits one task_status with from/to and skips when unchanged', () => {
    const group = makeGroup();
    const chat = makeChat();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard!.log = [];

    moveTaskStatus(group, 'W1-A', 'in_progress', chat);
    moveTaskStatus(group, 'W1-A', 'in_progress', chat);

    const statusEvents = group.orchestrateBoard!.log!.filter((e) => e.type === 'task_status');
    assert.equal(statusEvents.length, 1);
    assert.equal(statusEvents[0]?.detail?.from, 'planned');
    assert.equal(statusEvents[0]?.detail?.to, 'in_progress');
    assert.equal(statusEvents[0]?.level, 'info');
  });

  test('uses error level for failed and blocked transitions', () => {
    const group = makeGroup();
    const chat = makeChat();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard!.log = [];

    moveTaskStatus(group, 'W1-A', 'failed', chat);
    const failed = group.orchestrateBoard!.log!.find((e) => e.type === 'task_status');
    assert.equal(failed?.level, 'error');

    group.orchestrateBoard!.log = [];
    moveTaskStatus(group, 'W1-A', 'blocked', chat);
    const blocked = group.orchestrateBoard!.log!.find((e) => e.type === 'task_status');
    assert.equal(blocked?.level, 'error');
  });
});
