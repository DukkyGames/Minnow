/**
 * MIN-285 Phase 2 — self-heal escalation loop tests.
 *
 * Follows patterns from orchestrate-quarantine-completion.test.mts.
 * All external calls are mocked via the SelfHealDeps callback bag.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  runSelfHeal,
  type SelfHealDeps,
  type SelfHealOptions,
} from '../../src/state/orchestrate-self-heal.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { BoardTask, Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

const PLANNER_ID = 'aaaa-aaaa';
const GROUP_ID = 'grp_aaaa';
const PLAN_PATH = 'docs/plans/heal-test.md';

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: '/ws',
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

function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    title: id,
    wave: 'W1',
    category: 'build',
    status: 'in_progress',
    ...overrides,
  };
}

function makeSetup(tasks: BoardTask[]): { group: ChatGroup; planner: Chat } {
  const planner = makePlanner();
  const board: OrchestrateBoardState = {
    planPath: PLAN_PATH,
    startedAt: 1,
    lastUpdatedAt: 2,
    waves: [{ id: 'W1', status: 'planned' }],
    tasks,
    executionMode: 'afk',
    autoRunning: true,
  };
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: PLAN_PATH,
    orchestrateBoard: board,
  };
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { group, planner };
}

/**
 * Build a SelfHealDeps mock.
 * Returns { deps, s } where `s` is the shared mutable state.
 * Read outcomes from `s.*`; mutate control knobs on `s.*` before calling runSelfHeal.
 */
function makeDeps(): {
  deps: SelfHealDeps;
  s: {
    provisioned: boolean[];
    autoDelegateCalls: number;
    quarantineCalls: { taskId: string; category: string }[];
    startTaskCalls: string[];
    nudgeCalls: string[];
    fixerCalled: boolean;
    buildFailureRoute: 'failed' | 'retry';
    testFailureRoute: 'blocked' | 'retry';
  };
} {
  const s = {
    provisioned: [false] as boolean[],
    autoDelegateCalls: 0,
    quarantineCalls: [] as { taskId: string; category: string }[],
    startTaskCalls: [] as string[],
    nudgeCalls: [] as string[],
    fixerCalled: false,
    buildFailureRoute: 'retry' as 'failed' | 'retry',
    testFailureRoute: 'retry' as 'blocked' | 'retry',
  };

  const deps: SelfHealDeps = {
    async ensureBoardInfraProvisioned(_group, taskArg) {
      const wasAlreadyProvisioned = s.provisioned.shift() ?? false;
      return {
        wasAlreadyProvisioned,
        signatures: wasAlreadyProvisioned ? [] : [`sig:${taskArg.id}`],
        ok: true,
      };
    },
    applyTaskBuildFailureState() {
      return s.buildFailureRoute;
    },
    applyTaskTestFailureState() {
      return s.testFailureRoute;
    },
    buildBuildRetrySeedMessage() {
      return 'build-seed';
    },
    buildRetryBuilderSeedMessage() {
      return 'seed';
    },
    async startTask(_g, taskId) {
      s.startTaskCalls.push(taskId);
    },
    async startTaskTesting(_g, taskId) {
      s.startTaskCalls.push(`test:${taskId}`);
    },
    async startMergeConflictFixer() {
      s.fixerCalled = true;
    },
    async runTaskChatNudge(_g, taskId) {
      s.nudgeCalls.push(taskId);
    },
    async autoDelegateNext() {
      s.autoDelegateCalls++;
    },
    quarantineTaskAndDependents(_g, taskId, issue) {
      s.quarantineCalls.push({ taskId, category: issue?.category ?? 'unknown' });
    },
    resolveSelfHealMaxRounds: () => 2,
    resolveMaxMergeFixerAttempts: () => 2,
  };

  return { deps, s };
}

function opts(
  phase: 'build' | 'test' | 'merge',
  overrides: Partial<SelfHealOptions> = {},
): SelfHealOptions {
  return { phase, category: 'code', summary: 'test failure', ...overrides };
}

// ── Infra path ─────────────────────────────────────────────────────────────

describe('runSelfHeal — infra', () => {
  test('infra not provisioned → provision + re-run build + no attempt burn', async () => {
    const t = task('W1-A', { status: 'in_progress', buildAttempts: 0 });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.provisioned = [false];
    await runSelfHeal(group, t, planner, opts('build', { category: 'infra' }), deps);

    assert.equal(s.startTaskCalls.length, 1);
    assert.equal(s.startTaskCalls[0], 'W1-A');
    // no attempt burn: buildAttempts unchanged
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.buildAttempts, 0);
    // selfHealRound incremented to 1
    assert.equal(fresh.selfHealRound, 1);
    assert.equal(s.autoDelegateCalls, 1);
    assert.equal(s.quarantineCalls.length, 0);
  });

  test('infra already provisioned → quarantine (GAP-2: loop cannot spin)', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.provisioned = [true];
    await runSelfHeal(group, t, planner, opts('build', { category: 'infra' }), deps);

    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.quarantineCalls[0]!.category, 'infra');
    assert.equal(s.startTaskCalls.length, 0);
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('infra phase=test → provision + startTaskTesting', async () => {
    const t = task('W1-A', { status: 'testing' });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.provisioned = [false];
    await runSelfHeal(group, t, planner, opts('test', { category: 'infra' }), deps);

    assert.ok(s.startTaskCalls.includes('test:W1-A'));
    assert.equal(s.quarantineCalls.length, 0);
  });
});

// ── selfHealRound cap ──────────────────────────────────────────────────────

describe('runSelfHeal — selfHealRound cap', () => {
  test('selfHealRound at max → quarantine for code category', async () => {
    const t = task('W1-A', { selfHealRound: 2 }); // max = 2
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.startTaskCalls.length, 0);
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('selfHealRound at max → quarantine for infra category (cap checked first)', async () => {
    const t = task('W1-A', { selfHealRound: 2 });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'infra' }), deps);

    assert.equal(s.quarantineCalls.length, 1);
    // infra provision was NOT attempted (cap hit first)
    assert.equal(s.startTaskCalls.length, 0);
  });

  test('cap quarantine adds task id to unresolvedIssues', async () => {
    const t = task('W1-A', { selfHealRound: 2 });
    const { group, planner } = makeSetup([t]);

    const { deps } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    assert.ok(group.orchestrateBoard?.unresolvedIssues?.includes('W1-A'));
  });
});

// ── Code path ──────────────────────────────────────────────────────────────

describe('runSelfHeal — code', () => {
  test('code build retry → reseed + startTask', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.buildFailureRoute = 'retry';
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    assert.equal(s.startTaskCalls.length, 1);
    assert.equal(s.startTaskCalls[0], 'W1-A');
    assert.equal(s.quarantineCalls.length, 0);
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('code build exhausted → quarantine', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.buildFailureRoute = 'failed';
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.quarantineCalls[0]!.category, 'code');
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('code test exhausted → quarantine', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.testFailureRoute = 'blocked';
    await runSelfHeal(group, t, planner, opts('test', { category: 'code' }), deps);

    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.autoDelegateCalls, 1);
  });
});

// ── Stall path ─────────────────────────────────────────────────────────────

describe('runSelfHeal — stall', () => {
  test('first stall → nudge only, no reseed', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'stall' }), deps);

    assert.equal(s.nudgeCalls.length, 1);
    assert.equal(s.nudgeCalls[0], 'W1-A');
    assert.equal(s.startTaskCalls.length, 0);
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('recurring stall (lastHealCategory=stall) → treat as code', async () => {
    const t = task('W1-A', { lastHealCategory: 'stall' });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.buildFailureRoute = 'retry';
    await runSelfHeal(group, t, planner, opts('build', { category: 'stall' }), deps);

    // Escalated to code → no nudge, but reseed + startTask
    assert.equal(s.nudgeCalls.length, 0);
    assert.equal(s.startTaskCalls.length, 1);
  });
});

// ── Merge path ─────────────────────────────────────────────────────────────

describe('runSelfHeal — merge', () => {
  test('merge phase → startMergeConflictFixer called', async () => {
    const t = task('W1-A', { status: 'merging' });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('merge', { category: 'merge' }), deps);

    assert.equal(s.fixerCalled, true);
    assert.equal(s.quarantineCalls.length, 0);
  });

  test('merge attempts exhausted → quarantine with merge category', async () => {
    const t = task('W1-A', { status: 'merging', fixerAttempts: 2 }); // max = 2
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('merge', { category: 'merge' }), deps);

    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.quarantineCalls[0]!.category, 'merge');
    assert.equal(s.autoDelegateCalls, 1);
  });
});

// ── Dependent cascade + independent sibling ────────────────────────────────

describe('runSelfHeal — cascade + siblings', () => {
  test('quarantine delegates cascade to quarantineTaskAndDependents', async () => {
    const tA = task('W1-A', { selfHealRound: 2 });
    const tB = task('W1-B', { dependsOn: ['W1-A'] });
    const { group, planner } = makeSetup([tA, tB]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, tA, planner, opts('build', { category: 'code' }), deps);

    // quarantineTaskAndDependents receives the root task id;
    // the real impl does BFS cascade but we just verify the dep was invoked.
    assert.ok(s.quarantineCalls.some((c) => c.taskId === 'W1-A'));
  });

  test('autoDelegateNext always called so independent siblings keep running', async () => {
    const t = task('W1-A', { selfHealRound: 2 });
    const sibling = task('W1-B', { status: 'planned' });
    const { group, planner } = makeSetup([t, sibling]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    assert.equal(s.autoDelegateCalls, 1);
  });
});

// ── Test vs build exit routing ─────────────────────────────────────────────

describe('runSelfHeal — test phase routing', () => {
  test('test phase code retry → re-runs Builder (startTask, not startTaskTesting)', async () => {
    const t = task('W1-A', { status: 'testing' });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.testFailureRoute = 'retry';
    await runSelfHeal(group, t, planner, opts('test', { category: 'code' }), deps);

    assert.equal(s.startTaskCalls.length, 1);
    // startTask (builder), not test:W1-A — test failures re-seed the Builder
    assert.equal(s.startTaskCalls[0], 'W1-A');
  });
});
