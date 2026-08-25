/**
 * Phase 4: the finish report is reachable on a failed final test, tasks can be
 * appended to a running board, and run instructions round-trip through
 * board_report into the report.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  appendBoardTasks,
  initBoard,
  nextBoardWaveId,
  updateTask,
} from '../../src/state/orchestrate-board-store.ts';
import { validateBoardAddTasksArgs } from '../../src/tools/board-tools.ts';
import {
  canAccessOrchestrateFinishDashboard,
  isOrchestrateFinalTestFailed,
} from '../../src/chat/orchestrate/plan-complete.ts';
import { buildDeterministicFinishReport } from '../../src/chat/orchestrate/finish-stats.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

const PLANNER_ID = '62222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_62222222-2222-2222-2222-222222222222';

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

function makeGroup(
  tasks: Array<{ id: string; wave?: string | number; dependsOn?: string[] }> = [
    { id: 'W1-A' },
    { id: 'W1-B' },
  ],
  waves: Array<{ id: string | number }> = [{ id: 'W1' }],
): { group: ChatGroup; planner: Chat } {
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Append Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: 'documentation/plans/test.md',
    viewMode: 'board',
  };
  const planner = makePlanner();
  initBoard(group, planner, {
    planPath: 'documentation/plans/test.md',
    tasks: tasks.map((t) => ({
      id: t.id,
      title: `Task ${t.id}`,
      wave: t.wave ?? 'W1',
      category: 'build' as const,
      ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}),
    })),
    waves,
  });
  setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });
  return { group, planner };
}

describe('finish dashboard access on a failed final test (Phase 4.1)', () => {
  afterEach(() => setSessionStateForTests(null));

  test('reachable with a quarantined task present', () => {
    const { group } = makeGroup();
    const board = group.orchestrateBoard!;
    board.tasks[0]!.status = 'complete';
    board.tasks[1]!.status = 'quarantined';
    board.finalTest = { status: 'failed', summary: 'integration broke' };

    assert.equal(
      isOrchestrateFinalTestFailed(board),
      true,
      'plan is complete (all terminal) and the final test failed',
    );
    assert.equal(
      canAccessOrchestrateFinishDashboard(board),
      true,
      'one quarantined task must not hide the report',
    );
  });

  test('not reachable while tasks are still running', () => {
    const { group } = makeGroup();
    const board = group.orchestrateBoard!;
    board.tasks[0]!.status = 'complete';
    board.tasks[1]!.status = 'in_progress';
    board.finalTest = { status: 'failed', summary: 'integration broke' };

    assert.equal(canAccessOrchestrateFinishDashboard(board), false);
  });

  test('reachable without completionShownAt being set first', () => {
    const { group } = makeGroup();
    const board = group.orchestrateBoard!;
    for (const t of board.tasks) t.status = 'complete';
    board.finalTest = { status: 'failed', summary: 'integration broke' };
    delete board.completionShownAt;

    assert.equal(canAccessOrchestrateFinishDashboard(board), true);
  });
});

describe('appendBoardTasks (Phase 4.2)', () => {
  afterEach(() => setSessionStateForTests(null));

  test('appends into a new wave after the highest existing one', () => {
    const { group, planner } = makeGroup(
      [{ id: 'W1-A' }, { id: 'W2-A', wave: 'W2' }],
      [{ id: 'W1' }, { id: 'W2' }],
    );
    const board = group.orchestrateBoard!;
    assert.equal(nextBoardWaveId(board), 'W3');

    const added = appendBoardTasks(
      group,
      [{ id: 'W3-FIX', title: 'Fix it', wave: 'W3', category: 'fix' }],
      planner,
    );
    assert.equal(added.length, 1);
    assert.equal(added[0]!.wave, 'W3');
    assert.equal(added[0]!.status, 'planned');
    assert.equal(board.tasks.length, 3);
    assert.ok(board.waves.some((w) => w.id === 'W3'), 'the new wave is registered');
  });

  test('numeric wave ids stay numeric', () => {
    const { group } = makeGroup([{ id: 'T1', wave: 1 }], [{ id: 1 }]);
    assert.equal(nextBoardWaveId(group.orchestrateBoard!), 2);
  });

  test('existing tasks survive the append', () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    updateTask(group, 'W1-A', { status: 'complete' }, planner);

    appendBoardTasks(
      group,
      [{ id: 'W2-FIX', title: 'Fix it', wave: 'W2', category: 'fix' }],
      planner,
    );

    assert.equal(
      board.tasks.find((t) => t.id === 'W1-A')?.status,
      'complete',
      'append must not reset the board the way board_init does',
    );
  });
});

describe('validateBoardAddTasksArgs against the merged set (Phase 4.2)', () => {
  afterEach(() => setSessionStateForTests(null));

  function board(): OrchestrateBoardState {
    return makeGroup().group.orchestrateBoard!;
  }

  test('accepts a task depending on an existing task id', () => {
    const res = validateBoardAddTasksArgs(
      { tasks: [{ id: 'NEW-1', title: 'Follow up', category: 'fix', dependsOn: ['W1-A'] }] },
      board(),
    );
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.args.wave, 'W2');
      assert.deepEqual(res.args.tasks[0]!.dependsOn, ['W1-A']);
    }
  });

  test('rejects an id that collides with an existing task', () => {
    const res = validateBoardAddTasksArgs(
      { tasks: [{ id: 'W1-A', title: 'Dupe', category: 'fix' }] },
      board(),
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /duplicate task id/);
  });

  test('rejects a dependency on a task that does not exist anywhere', () => {
    const res = validateBoardAddTasksArgs(
      { tasks: [{ id: 'NEW-1', title: 'Follow up', category: 'fix', dependsOn: ['NOPE'] }] },
      board(),
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /unknown task "NOPE"/);
  });

  test('rejects a cycle closed through the new tasks', () => {
    const res = validateBoardAddTasksArgs(
      {
        tasks: [
          { id: 'NEW-1', title: 'One', category: 'fix', dependsOn: ['NEW-2'] },
          { id: 'NEW-2', title: 'Two', category: 'fix', dependsOn: ['NEW-1'] },
        ],
      },
      board(),
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /cycle/);
  });

  test('rejects an empty task list', () => {
    const res = validateBoardAddTasksArgs({ tasks: [] }, board());
    assert.equal(res.ok, false);
  });

  test('rejects when there is no board yet', () => {
    const res = validateBoardAddTasksArgs(
      { tasks: [{ id: 'NEW-1', title: 'One', category: 'fix' }] },
      null,
    );
    assert.equal(res.ok, false);
  });
});

describe('appendFinalTestFixTask (Phase 4.3)', () => {
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
  });

  afterEach(() => {
    setSessionStateForTests(null);
    if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
    else process.env.MINNOW_TEST = prevMinnowTest;
  });

  test('appends one fix task in a new wave and resets the final-test gate', async () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    for (const t of board.tasks) t.status = 'complete';
    board.finalTest = {
      status: 'failed',
      attempts: 1,
      chatId: 'tester-chat',
      summary: 'Login flow 500s after the settings refactor',
      failingTaskIds: ['W1-A'],
    };
    board.completionShownAt = Date.now();
    board.finishReport = 'stale report';

    const { appendFinalTestFixTask } = await import(
      '../../src/state/orchestrate-board-actions.ts'
    );
    const taskId = await appendFinalTestFixTask(group, planner);

    assert.ok(taskId, 'a fix task id is returned');
    const fix = board.tasks.find((t) => t.id === taskId)!;
    assert.equal(fix.category, 'fix');
    assert.equal(fix.wave, 'W2', 'lands in a brand-new wave');
    assert.match(
      fix.buildSpec ?? '',
      /Login flow 500s/,
      'seeded from the tester summary',
    );
    assert.match(fix.buildSpec ?? '', /W1-A/, 'names the tasks held responsible');
    assert.match(fix.buildSpec ?? '', /tester-chat/, 'references the tester chat');

    assert.equal(board.finalTest?.status, 'pending', 'final test can fire again');
    assert.equal(board.finalTest?.summary, undefined, 'stale summary cleared');
    assert.equal(board.finalTest?.attempts, 1, 'attempt count is preserved');
    assert.equal(board.completionShownAt, undefined);
    assert.equal(board.finishReport, undefined, 'stale report dropped');
    assert.equal(board.dashboardDismissed, true, 'returns to the kanban');

    assert.equal(
      board.tasks.filter((t) => t.status === 'complete').length,
      2,
      'tasks that passed are left alone — the failure is between them',
    );
  });

  test('does nothing when the final test has not failed', async () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    board.finalTest = { status: 'passed' };

    const { appendFinalTestFixTask } = await import(
      '../../src/state/orchestrate-board-actions.ts'
    );
    assert.equal(await appendFinalTestFixTask(group, planner), null);
    assert.equal(board.tasks.length, 2);
  });
});

describe('run instructions in the finish report (Phase 4.4)', () => {
  afterEach(() => setSessionStateForTests(null));

  test('prints the tester-verified commands and marks them verified', () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    for (const t of board.tasks) t.status = 'complete';
    board.finalTest = {
      status: 'passed',
      runInstructions: {
        install: 'pnpm install',
        start: 'pnpm dev',
        test: 'pnpm test',
        notes: 'Needs Postgres on 5432.',
      },
    };

    const report = buildDeterministicFinishReport(planner, board);
    assert.match(report, /pnpm install/);
    assert.match(report, /pnpm dev/);
    assert.match(report, /Needs Postgres on 5432\./);
    assert.match(report, /Verified by the final integration tester/);
    assert.equal(
      /npm start/.test(report),
      false,
      'the hardcoded npm block is gone',
    );
  });

  test('leaves a detection placeholder when the tester reported nothing', () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    for (const t of board.tasks) t.status = 'complete';
    board.finalTest = { status: 'passed' };

    const report = buildDeterministicFinishReport(planner, board);
    assert.match(report, /Detecting run commands/);
    assert.equal(/npm install/.test(report), false);
  });

  test('next steps and branch line follow the isolation mode', () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    for (const t of board.tasks) t.status = 'complete';

    board.isolationMode = 'off';
    const noBranch = buildDeterministicFinishReport(planner, board);
    assert.match(noBranch, /Isolation off/);
    assert.match(noBranch, /Review & commit/);

    board.isolationMode = 'per-task';
    board.integrationBranch = 'minnow/board/b/integration';
    const withBranch = buildDeterministicFinishReport(planner, board);
    assert.match(withBranch, /Integration branch/);
    assert.match(withBranch, /Commit & push/);
  });
});
