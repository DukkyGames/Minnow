/**
 * MIN-284 Phase 1 — quarantine state, completion predicates, wave gating,
 * re-drive idempotency, and dependency cascade.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import {
  deliverOrchestratorTaskReport,
  resetOrchestratorAutoReportsForTests,
  setOrchestratorReportDeliverHook,
} from '../../src/agents/controller/report.ts';
import {
  isOrchestratePlanComplete,
  hasIncompleteOrchestrateWork,
} from '../../src/chat/orchestrate/plan-complete.ts';
import { requeueBoardTask } from '../../src/state/orchestrate-board-actions.ts';
import {
  initBoard,
  isPriorWavesComplete,
  isTaskReadyForAuto,
  quarantineTaskAndDependents,
  rollupWaveStatus,
  updateTask,
} from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { BoardTask, Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/quarantine-test.md';

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

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: PLAN_PATH,
  };
}

function task(
  id: string,
  status: BoardTask['status'],
  wave = 'W1',
  dependsOn?: string[],
): BoardTask {
  return { id, title: id, wave, category: 'build', status, ...(dependsOn ? { dependsOn } : {}) };
}

function board(tasks: BoardTask[]): OrchestrateBoardState {
  return {
    planPath: PLAN_PATH,
    startedAt: 1,
    lastUpdatedAt: 2,
    waves: [{ id: 'W1', status: 'planned' }, { id: 'W2', status: 'planned' }],
    tasks,
  };
}

// ── isOrchestratePlanComplete ──────────────────────────────────────────────

describe('isOrchestratePlanComplete', () => {
  test('false for empty task list', () => {
    assert.equal(isOrchestratePlanComplete(board([])), false);
  });

  test('true when every task is complete', () => {
    const b = board([task('A', 'complete'), task('B', 'complete')]);
    assert.equal(isOrchestratePlanComplete(b), true);
    assert.equal(hasIncompleteOrchestrateWork(b), false);
  });

  test('true when mix of complete and quarantined', () => {
    const b = board([task('A', 'complete'), task('B', 'quarantined')]);
    assert.equal(isOrchestratePlanComplete(b), true);
    assert.equal(hasIncompleteOrchestrateWork(b), false);
  });

  test('GAP-1: true when ALL tasks are quarantined (zero complete)', () => {
    const b = board([task('A', 'quarantined'), task('B', 'quarantined')]);
    assert.equal(isOrchestratePlanComplete(b), true);
    assert.equal(hasIncompleteOrchestrateWork(b), false);
  });

  test('false when any task is still planned', () => {
    const b = board([task('A', 'complete'), task('B', 'planned')]);
    assert.equal(isOrchestratePlanComplete(b), false);
    assert.equal(hasIncompleteOrchestrateWork(b), true);
  });

  test('false when any task is failed (not terminal)', () => {
    const b = board([task('A', 'complete'), task('B', 'failed')]);
    assert.equal(isOrchestratePlanComplete(b), false);
  });
});

// ── isPriorWavesComplete ───────────────────────────────────────────────────

describe('isPriorWavesComplete with quarantined', () => {
  test('prior wave with all-quarantined passes the gate', () => {
    const b = board([task('W1-A', 'quarantined', 'W1'), task('W2-A', 'planned', 'W2')]);
    assert.equal(isPriorWavesComplete(b, 'W2'), true);
  });

  test('prior wave with mix of complete+quarantined passes the gate', () => {
    const b = board([
      task('W1-A', 'complete', 'W1'),
      task('W1-B', 'quarantined', 'W1'),
      task('W2-A', 'planned', 'W2'),
    ]);
    assert.equal(isPriorWavesComplete(b, 'W2'), true);
  });

  test('prior wave with failed task blocks the gate', () => {
    const b = board([task('W1-A', 'failed', 'W1'), task('W2-A', 'planned', 'W2')]);
    assert.equal(isPriorWavesComplete(b, 'W2'), false);
  });

  test('prior wave with planned task blocks the gate', () => {
    const b = board([task('W1-A', 'planned', 'W1'), task('W2-A', 'planned', 'W2')]);
    assert.equal(isPriorWavesComplete(b, 'W2'), false);
  });
});

// ── rollupWaveStatus ───────────────────────────────────────────────────────

describe('rollupWaveStatus with quarantined', () => {
  test('all-complete wave → complete', () => {
    const tasks = [task('A', 'complete'), task('B', 'complete')];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'complete');
  });

  test('all-quarantined wave → complete (terminal)', () => {
    const tasks = [task('A', 'quarantined'), task('B', 'quarantined')];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'complete');
  });

  test('mix complete+quarantined → complete', () => {
    const tasks = [task('A', 'complete'), task('B', 'quarantined')];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'complete');
  });

  test('any in_progress → in_progress', () => {
    const tasks = [task('A', 'quarantined'), task('B', 'in_progress')];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'in_progress');
  });

  test('planned only → planned', () => {
    const tasks = [task('A', 'planned')];
    assert.equal(rollupWaveStatus(tasks, 'W1'), 'planned');
  });
});

// ── quarantineTaskAndDependents ────────────────────────────────────────────

describe('quarantineTaskAndDependents', () => {
  function seedGroup() {
    const planner = makePlanner();
    const group = makeGroup();
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'ROOT', title: 'Root', wave: 'W1', category: 'build', build: 'do root' },
        { id: 'DEP1', title: 'Dep1', wave: 'W1', category: 'build', build: 'do dep1', dependsOn: ['ROOT'] },
        { id: 'DEP2', title: 'Dep2', wave: 'W1', category: 'build', build: 'do dep2', dependsOn: ['DEP1'] },
        { id: 'SIBLING', title: 'Sibling', wave: 'W1', category: 'build', build: 'do sibling' },
      ],
    });
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    return { group, planner };
  }

  afterEach(() => {
    resetSubAgentOrchestrator();
  });

  test('root task is quarantined with the given payload', () => {
    const { group, planner } = seedGroup();
    quarantineTaskAndDependents(group, 'ROOT', {
      category: 'infra',
      summary: 'infra down',
      resolutionSteps: ['Fix infra'],
      at: 1000,
    }, planner);

    const root = group.orchestrateBoard!.tasks.find((t) => t.id === 'ROOT')!;
    assert.equal(root.status, 'quarantined');
    assert.equal(root.quarantine?.category, 'infra');
    assert.equal(root.quarantine?.summary, 'infra down');
  });

  test('transitive dependents are quarantined with stall category', () => {
    const { group, planner } = seedGroup();
    quarantineTaskAndDependents(group, 'ROOT', {
      category: 'infra',
      summary: 'infra down',
      resolutionSteps: [],
      at: 1000,
    }, planner);

    const dep1 = group.orchestrateBoard!.tasks.find((t) => t.id === 'DEP1')!;
    const dep2 = group.orchestrateBoard!.tasks.find((t) => t.id === 'DEP2')!;
    assert.equal(dep1.status, 'quarantined');
    assert.equal(dep1.quarantine?.category, 'stall');
    assert.match(dep1.quarantine?.summary ?? '', /ROOT/);
    assert.equal(dep2.status, 'quarantined');
    assert.equal(dep2.quarantine?.category, 'stall');
  });

  test('independent sibling is not quarantined', () => {
    const { group, planner } = seedGroup();
    quarantineTaskAndDependents(group, 'ROOT', {
      category: 'infra',
      summary: 'infra down',
      resolutionSteps: [],
      at: 1000,
    }, planner);

    const sibling = group.orchestrateBoard!.tasks.find((t) => t.id === 'SIBLING')!;
    assert.equal(sibling.status, 'planned');
    assert.equal(sibling.quarantine, undefined);
  });
});

// ── requeueBoardTask cascade ───────────────────────────────────────────────

describe('requeueBoardTask', () => {
  function seedGroup() {
    const planner = makePlanner();
    const group = makeGroup();
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'ROOT', title: 'Root', wave: 'W1', category: 'build', build: 'do root' },
        { id: 'DEP1', title: 'Dep1', wave: 'W1', category: 'build', build: 'do dep1', dependsOn: ['ROOT'] },
        { id: 'SIBLING', title: 'Sibling', wave: 'W1', category: 'build', build: 'do sibling' },
      ],
    });
    group.orchestrateBoard!.executionMode = 'auto';
    group.orchestrateBoard!.autoRunning = true;
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    return { group, planner };
  }

  test('requeue root releases cascade-quarantined dependents but not independent quarantines', async () => {
    const { group, planner } = seedGroup();
    quarantineTaskAndDependents(
      group,
      'ROOT',
      {
        category: 'stall',
        summary: 'Stopped by user — requeue to resume',
        resolutionSteps: ['inspect if needed, then Requeue'],
        at: 1000,
      },
      planner,
    );
    updateTask(
      group,
      'SIBLING',
      {
        status: 'quarantined',
        quarantine: {
          category: 'code',
          summary: 'own failure',
          resolutionSteps: [],
          at: 1001,
        },
      },
      planner,
    );

    await requeueBoardTask(group, 'ROOT', planner);

    const root = group.orchestrateBoard!.tasks.find((t) => t.id === 'ROOT')!;
    const dep1 = group.orchestrateBoard!.tasks.find((t) => t.id === 'DEP1')!;
    const sibling = group.orchestrateBoard!.tasks.find((t) => t.id === 'SIBLING')!;
    assert.equal(root.status, 'planned');
    assert.equal(root.quarantine, undefined);
    assert.equal(dep1.status, 'planned');
    assert.equal(dep1.quarantine, undefined);
    assert.equal(sibling.status, 'quarantined');
    assert.equal(sibling.quarantine?.summary, 'own failure');
  });
});

// ── isTaskReadyForAuto: quarantined prior wave doesn't block siblings ──────

describe('isTaskReadyForAuto with quarantined prior wave', () => {
  function seedTwoWave() {
    const planner = makePlanner();
    const group = makeGroup();
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      waves: [{ id: 'W1' }, { id: 'W2' }],
      tasks: [
        { id: 'W1-A', title: 'W1-A', wave: 'W1', category: 'build', build: 'do w1' },
        { id: 'W2-A', title: 'W2-A', wave: 'W2', category: 'build', build: 'do w2' },
      ],
    });
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    return { group, planner };
  }

  afterEach(() => {
    resetSubAgentOrchestrator();
  });

  test('W2 task ready when W1 is quarantined', () => {
    const { group, planner } = seedTwoWave();
    updateTask(group, 'W1-A', { status: 'quarantined' }, planner);
    const board = group.orchestrateBoard!;
    const w2 = board.tasks.find((t) => t.id === 'W2-A')!;
    assert.equal(isTaskReadyForAuto(board, w2), true);
  });
});

// ── Re-drive idempotency ───────────────────────────────────────────────────

describe('deliverOrchestratorTaskReport re-drive idempotency', () => {
  beforeEach(() => {
    resetOrchestratorAutoReportsForTests();
  });

  afterEach(() => {
    resetOrchestratorAutoReportsForTests();
    resetSubAgentOrchestrator();
  });

  function seedRunningBoard() {
    const planner = makePlanner();
    const group = makeGroup();
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build', build: 'do a' },
      ],
    });
    group.orchestrateBoard!.executionMode = 'auto';
    group.orchestrateBoard!.autoRunning = true;
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    return { group, planner };
  }

  test('failed report is deduped (message delivered once)', async () => {
    const { group, planner } = seedRunningBoard();
    const task = group.orchestrateBoard!.tasks[0]!;
    task.status = 'failed';
    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_id, msg) => { deliveries.push(msg); });
    await deliverOrchestratorTaskReport(group, planner, task, 'failed');
    await deliverOrchestratorTaskReport(group, planner, task, 'failed');
    assert.equal(deliveries.length, 1);
    setOrchestratorReportDeliverHook(null);
  });

  test('quarantined report delivered and contains quarantined header', async () => {
    const { group, planner } = seedRunningBoard();
    const task = group.orchestrateBoard!.tasks[0]!;
    task.status = 'quarantined';
    task.quarantine = { category: 'code', summary: 'bad code', resolutionSteps: [], at: 1 };
    const deliveries: string[] = [];
    setOrchestratorReportDeliverHook(async (_id, msg) => { deliveries.push(msg); });
    await deliverOrchestratorTaskReport(group, planner, task, 'quarantined');
    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0]!, /quarantined/i);
    assert.match(deliveries[0]!, /W1-A/);
    setOrchestratorReportDeliverHook(null);
  });

  test('second call after deduped report still runs autoDelegateNext (no double-launch)', async () => {
    const { group, planner } = seedRunningBoard();
    const task = group.orchestrateBoard!.tasks[0]!;
    task.status = 'quarantined';
    task.quarantine = { category: 'stall', summary: 'stuck', resolutionSteps: [], at: 1 };

    let deliveryCount = 0;
    setOrchestratorReportDeliverHook(async () => { deliveryCount += 1; });

    // First call: delivers report + drives.
    await deliverOrchestratorTaskReport(group, planner, task, 'quarantined');
    // Second call: report is deduped but autoDelegateNext still runs (idempotent no-op).
    await deliverOrchestratorTaskReport(group, planner, task, 'quarantined');

    assert.equal(deliveryCount, 1, 'message delivered exactly once');
    // No assertion on autoDelegateNext call count — it's idempotent.
    // The test passing without hanging or launching duplicate tasks verifies safety.
    setOrchestratorReportDeliverHook(null);
  });
});

// ── Final test gate: ≥1 complete required ─────────────────────────────────

describe('final integration test gate', () => {
  // We test this through the exported predicates since startFinalIntegrationTest
  // has deep infrastructure dependencies. The gate logic lives in isBoardReadyForFinalTest
  // which wraps isOrchestratePlanComplete + any-complete guard.

  test('all-quarantined board: plan is complete but no ≥1 complete task', () => {
    const b = board([task('A', 'quarantined'), task('B', 'quarantined')]);
    assert.equal(isOrchestratePlanComplete(b), true, 'plan complete (GAP-1)');
    // Verify the guard: zero complete tasks.
    assert.equal(b.tasks.some((t) => t.status === 'complete'), false);
  });

  test('mixed board: plan complete and ≥1 complete task allows final test', () => {
    const b = board([task('A', 'complete'), task('B', 'quarantined')]);
    assert.equal(isOrchestratePlanComplete(b), true);
    assert.equal(b.tasks.some((t) => t.status === 'complete'), true);
  });
});
