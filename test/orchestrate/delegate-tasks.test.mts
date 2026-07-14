/**
 * Orchestrate auto-delegation: delegate_tasks tool, executionMode, wave readiness.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import {
  buildOrchestratorTaskReportMessage,
  deliverOrchestratorTaskReport,
  resetOrchestratorAutoReportsForTests,
  setOrchestratorReportDeliverHook,
} from '../../src/agents/controller/report.ts';
import { setStreaming } from '../../src/app-state.ts';
import { isChatStreaming } from '../../src/chat/streaming-state.ts';
import {
  getBoardExecutionMode,
  isBoardAutoMode,
} from '../../src/state/orchestrate-board-store.ts';
import { applyOrchestrateAutoToolFilter } from '../../src/chat/modes/orchestrate-tool-filter.ts';
import { filterToolsByMode } from '../../src/chat/modes/tool-policy.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import {
  executeBoardTool,
  validateDelegateTasksArgs,
} from '../../src/tools/board-tools.ts';
import { setBoardMaxConcurrent } from '../../src/state/orchestrate-board-actions.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  initBoard,
  isPriorWavesComplete,
  isTaskReadyForAuto,
} from '../../src/state/orchestrate-board-store.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/auto-delegate.md';

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
    orchestratePlanPath: PLAN_PATH,
    boardGroupId: GROUP_ID,
  };
}

function makeGroup(board?: ChatGroup['orchestrateBoard']): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Orchestrate folder',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
    plannerChatId: PLANNER_ID,
    ...(board ? { orchestrateBoard: board } : {}),
  };
}

function seedBoard(executionMode: 'manual' | 'auto' = 'manual') {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }, { id: 'W2' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Wave one task',
        wave: 'W1',
        category: 'build',
        build: 'Do W1',
      },
      {
        id: 'W2-A',
        title: 'Wave two task',
        wave: 'W2',
        category: 'build',
        build: 'Do W2',
      },
    ],
  });
  group.orchestrateBoard!.executionMode = executionMode;
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { planner, group };
}

describe('orchestrate delegate_tasks', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
  });

  afterEach(() => {
    resetOrchestratorAutoReportsForTests();
    resetSubAgentOrchestrator();
  });

  test('validateDelegateTasksArgs accepts taskIds array', () => {
    const result = validateDelegateTasksArgs({ taskIds: ['W1-A', 'W1-B'] });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.args.taskIds, ['W1-A', 'W1-B']);
    }
  });

  test('initBoard sets executionMode manual', () => {
    const { group } = seedBoard();
    assert.equal(group.orchestrateBoard?.executionMode, 'manual');
    assert.equal(getBoardExecutionMode(group.orchestrateBoard), 'manual');
    assert.equal(getBoardExecutionMode(undefined), 'manual');
  });

  test('delegate_tasks omitted from planner tools in manual and auto modes', () => {
    const base = filterToolsByMode(BUILT_IN_TOOLS, 'orchestrate').map((t) => t.definition);
    const withDelegate = base.some((d) => d.function.name === 'delegate_tasks');
    assert.ok(withDelegate, 'delegate_tasks remains in orchestrate catalog');
    for (const mode of ['manual', 'auto'] as const) {
      const names = applyOrchestrateAutoToolFilter(base, mode).map((d) => d.function.name);
      assert.ok(!names.includes('delegate_tasks'), `expected omit in ${mode}`);
    }
  });

  test('orchestrate mode denies spawn_sub_agent via tool policy', () => {
    const names = filterToolsByMode(BUILT_IN_TOOLS, 'orchestrate').map(
      (t) => t.definition.function.name,
    );
    assert.ok(!names.includes('spawn_sub_agent'));
    assert.ok(!names.includes('cancel_sub_agent'));
  });

  test('isTaskReadyForAuto respects prior wave completion', () => {
    const { group } = seedBoard('auto');
    const board = group.orchestrateBoard!;
    const w1 = board.tasks.find((t) => t.id === 'W1-A')!;
    const w2 = board.tasks.find((t) => t.id === 'W2-A')!;
    assert.equal(isTaskReadyForAuto(board, w1), true);
    assert.equal(isTaskReadyForAuto(board, w2), false);
    assert.equal(isPriorWavesComplete(board, 'W2'), false);
    w1.status = 'complete';
    assert.equal(isTaskReadyForAuto(board, w2), true);
  });

  test('executeBoardTool delegate_tasks rejects manual mode', async () => {
    const { planner } = seedBoard('manual');
    const out = await executeBoardTool(
      'delegate_tasks',
      { taskIds: ['W1-A'] },
      { chatId: planner.id },
    );
    assert.match(out, /executionMode auto/i);
  });

  test('setBoardExecutionMode persists auto on board without starting tasks', () => {
    const { planner, group } = seedBoard('manual');
    boardSetExecutionModeOnly(group, 'auto');
    assert.equal(group.orchestrateBoard?.executionMode, 'auto');
    assert.equal(getBoardExecutionMode(group.orchestrateBoard), 'auto');
    void planner;
  });
});

/** Test helper: set mode without auto-delegate side effects. */
function boardSetExecutionModeOnly(
  group: ChatGroup,
  mode: 'manual' | 'auto',
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.executionMode = mode;
  board.lastUpdatedAt = Date.now();
}

describe('orchestrator auto reports', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
  });

  afterEach(() => {
    resetOrchestratorAutoReportsForTests();
    resetSubAgentOrchestrator();
  });

  test('buildOrchestratorTaskReportMessage includes task id and lifecycle', () => {
    const message = buildOrchestratorTaskReportMessage(
      {
        id: 'W1-A',
        title: 'Build feature',
        wave: 'W1',
        category: 'build',
        status: 'complete',
        notes: 'Shipped the API',
      },
      'completed',
      'complete',
    );
    assert.match(message, /W1-A/);
    assert.match(message, /Lifecycle: complete/);
    assert.match(message, /Shipped the API/);
    assert.doesNotMatch(message, /delegate_tasks/);
    assert.match(message, /Auto-pilot starts the next ready planned tasks automatically/);
    assert.doesNotMatch(message, /board_update_task/);
  });

  test('deliverOrchestratorTaskReport dedupes by task, kind, and lifecycle run', async () => {
    const { planner, group } = seedBoard('auto');
    group.orchestrateBoard!.autoRunning = true;
    const task = group.orchestrateBoard!.tasks[0]!;
    task.status = 'failed';
    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_chatId, message) => {
      deliveries.push(message);
    });
    await deliverOrchestratorTaskReport(group, planner, task, 'failed');
    await deliverOrchestratorTaskReport(group, planner, task, 'failed');
    assert.equal(deliveries.length, 1);

    task.lifecycleRun = 1;
    await deliverOrchestratorTaskReport(group, planner, task, 'failed');
    assert.equal(deliveries.length, 2);
    setOrchestratorReportDeliverHook(null);
  });

  test('defers failure reports while planner is streaming; flushes on stream end', async () => {
    const { planner, group } = seedBoard('auto');
    setSessionStateForTests({ version: 5, activeId: PLANNER_ID, chats: [planner], groups: [group] });
    group.orchestrateBoard!.autoRunning = true;
    const taskA = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    taskA.status = 'failed';

    planner.history.push({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'board_get_state', arguments: '{}' } }],
    });

    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_chatId, message) => {
      deliveries.push(message);
    });

    setStreaming(true, planner.id);
    await deliverOrchestratorTaskReport(group, planner, taskA, 'failed');
    assert.equal(deliveries.length, 0, 'report should be deferred while streaming');

    const { notifyChatStreamEnded } = await import('../../src/chat/streaming-state.ts');
    const { initOrchestratorAutoReports } = await import('../../src/agents/controller/report.ts');
    initOrchestratorAutoReports();
    notifyChatStreamEnded(planner.id);
    setStreaming(false, planner.id);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deliveries.length, 1);
    assert.ok(deliveries[0]!.includes('W1-A'));
    setOrchestratorReportDeliverHook(null);
  });

  test('silent delivery appends assistant message without starting a planner turn', async () => {
    const { planner, group } = seedBoard('auto');
    setSessionStateForTests({ version: 5, activeId: PLANNER_ID, chats: [planner], groups: [group] });
    group.orchestrateBoard!.autoRunning = true;
    const task = group.orchestrateBoard!.tasks[0]!;
    task.status = 'complete';
    task.notes = 'Done';

    setOrchestratorReportDeliverHook(null);
    const historyBefore = planner.history.length;
    await deliverOrchestratorTaskReport(group, planner, task, 'complete');

    assert.equal(planner.history.length, historyBefore + 1);
    const last = planner.history[planner.history.length - 1]!;
    assert.equal(last.role, 'assistant');
    assert.match(String(last.content), /W1-A/);
    assert.equal(isChatStreaming(planner.id), false);
  });
});

// ─── Sequential mode and setBoardExecutionMode widening ──────────────────

describe('sequential execution mode', () => {
  test('getBoardExecutionMode returns sequential when set', () => {
    const { group } = seedBoard('manual');
    group.orchestrateBoard!.executionMode = 'sequential';
    assert.equal(getBoardExecutionMode(group.orchestrateBoard), 'sequential');
  });

  test('isBoardAutoMode true for auto, sequential, and afk', () => {
    const { group } = seedBoard('manual');
    group.orchestrateBoard!.executionMode = 'auto';
    assert.equal(isBoardAutoMode(group), true);
    group.orchestrateBoard!.executionMode = 'sequential';
    assert.equal(isBoardAutoMode(group), true);
    group.orchestrateBoard!.executionMode = 'afk';
    assert.equal(isBoardAutoMode(group), true);
    group.orchestrateBoard!.executionMode = 'manual';
    assert.equal(isBoardAutoMode(group), false);
  });

  test('delegate_tasks rejects sequential mode (not auto)', async () => {
    const { planner, group } = seedBoard('manual');
    group.orchestrateBoard!.executionMode = 'sequential';
    setSessionStateForTests({ version: 5, activeId: PLANNER_ID, chats: [planner], groups: [group] });
    const out = await executeBoardTool(
      'delegate_tasks',
      { taskIds: ['W1-A'] },
      { chatId: planner.id },
    );
    assert.match(out, /executionMode auto/i);
  });

  test('getBoardExecutionMode falls back to manual for unknown values', () => {
    const board = { executionMode: 'unknown' as any };
    assert.equal(getBoardExecutionMode(board as any), 'manual');
  });
});

// ─── setBoardMaxConcurrent ────────────────────────────────────────────────

describe('setBoardMaxConcurrent', () => {
  test('clamps value to [1, 20]', () => {
    const { planner, group } = seedBoard('auto');
    setBoardMaxConcurrent(group, 0, planner);
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 1);
    setBoardMaxConcurrent(group, 99, planner);
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 20);
    setBoardMaxConcurrent(group, 5, planner);
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 5);
  });

  test('floors fractional values', () => {
    const { planner, group } = seedBoard('auto');
    setBoardMaxConcurrent(group, 3.9, planner);
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 3);
  });

  test('no-op when value unchanged', () => {
    const { planner, group } = seedBoard('auto');
    group.orchestrateBoard!.maxConcurrentTasks = 5;
    const before = group.orchestrateBoard!.lastUpdatedAt;
    setBoardMaxConcurrent(group, 5, planner);
    assert.equal(group.orchestrateBoard?.lastUpdatedAt, before);
  });
});
