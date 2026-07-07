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
    maxEnvFixAttempts: number;
    autoDelegateCalls: number;
    quarantineCalls: { taskId: string; category: string }[];
    startTaskCalls: string[];
    nudgeCalls: string[];
    envFixerCalls: { taskId: string; phase: string }[];
    fixerCalled: boolean;
    buildFailureRoute: 'failed' | 'retry';
    testFailureRoute: 'blocked' | 'retry';
  };
} {
  const s = {
    maxEnvFixAttempts: 2,
    autoDelegateCalls: 0,
    quarantineCalls: [] as { taskId: string; category: string }[],
    startTaskCalls: [] as string[],
    nudgeCalls: [] as string[],
    envFixerCalls: [] as { taskId: string; phase: string }[],
    fixerCalled: false,
    buildFailureRoute: 'retry' as 'failed' | 'retry',
    testFailureRoute: 'retry' as 'blocked' | 'retry',
  };

  const deps: SelfHealDeps = {
    async startEnvFixer(_group, taskArg, _planner, phase) {
      s.envFixerCalls.push({ taskId: taskArg.id, phase });
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
    resolveMaxEnvFixAttempts: () => s.maxEnvFixAttempts,
    resolveAfkAutoRestartStalls: () => true,
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

// ── Stopped board guard ────────────────────────────────────────────────────

describe('runSelfHeal — board not running', () => {
  test('autoRunning=false → records error only, no heal work or quarantine', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);
    group.orchestrateBoard!.autoRunning = false;

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'infra' }), deps);

    assert.equal(s.envFixerCalls.length, 0, 'must not spawn env fixers on a stopped board');
    assert.equal(s.startTaskCalls.length, 0);
    assert.equal(s.nudgeCalls.length, 0);
    assert.equal(s.quarantineCalls.length, 0, 'must not quarantine on user Stop');
    assert.equal(s.autoDelegateCalls, 0);
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.error, 'test failure', 'failure summary must be recorded');
    assert.equal(fresh.selfHealRound ?? 0, 0);
    assert.equal(fresh.envFixAttempts ?? 0, 0);
  });

  test('manual mode board → same guard applies', async () => {
    const t = task('W1-A');
    const { group, planner } = makeSetup([t]);
    group.orchestrateBoard!.executionMode = 'manual';

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    assert.equal(s.startTaskCalls.length, 0);
    assert.equal(s.quarantineCalls.length, 0);
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.error, 'test failure');
  });
});

// ── Infra path ─────────────────────────────────────────────────────────────

describe('runSelfHeal — infra (env-fixer)', () => {
  test('infra under attempt cap → spawn env-fixer, no attempt burn, no quarantine', async () => {
    const t = task('W1-A', { status: 'in_progress', buildAttempts: 0 });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'infra' }), deps);

    assert.equal(s.envFixerCalls.length, 1);
    assert.equal(s.envFixerCalls[0]!.taskId, 'W1-A');
    assert.equal(s.envFixerCalls[0]!.phase, 'build');
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    // env-fixer is not a build attempt; envFixAttempts + selfHealRound bumped.
    assert.equal(fresh.buildAttempts, 0);
    assert.equal(fresh.envFixAttempts, 1);
    assert.equal(fresh.selfHealRound, 1);
    assert.equal(s.quarantineCalls.length, 0);
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('infra env-fixer attempts exhausted → quarantine', async () => {
    const t = task('W1-A', { envFixAttempts: 2 }); // max = 2
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'infra' }), deps);

    assert.equal(s.envFixerCalls.length, 0);
    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.quarantineCalls[0]!.category, 'infra');
    assert.equal(s.autoDelegateCalls, 1);
  });

  test('infra phase=test → env-fixer spawned for the test phase', async () => {
    const t = task('W1-A', { status: 'testing' });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('test', { category: 'infra' }), deps);

    assert.equal(s.envFixerCalls.length, 1);
    assert.equal(s.envFixerCalls[0]!.phase, 'test');
    assert.equal(s.quarantineCalls.length, 0);
  });

  test('infra during merge phase → quarantine (env fix cannot help a merge)', async () => {
    const t = task('W1-A', { status: 'merging' });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    await runSelfHeal(group, t, planner, opts('merge', { category: 'infra' }), deps);

    assert.equal(s.envFixerCalls.length, 0);
    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.quarantineCalls[0]!.category, 'infra');
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
    // env-fixer was NOT spawned (global ceiling hit before the infra branch)
    assert.equal(s.envFixerCalls.length, 0);
    assert.equal(s.startTaskCalls.length, 0);
  });

  test('cap quarantine adds task id to unresolvedIssues', async () => {
    const t = task('W1-A', { selfHealRound: 2 });
    const { group, planner } = makeSetup([t]);

    const { deps } = makeDeps();
    await runSelfHeal(group, t, planner, opts('build', { category: 'code' }), deps);

    const issues = group.orchestrateBoard?.unresolvedIssues ?? [];
    assert.ok(issues.length > 0, 'unresolvedIssues should be non-empty');
    const issue = issues.find((u) => u.taskId === 'W1-A');
    assert.ok(issue, 'should have an UnresolvedIssue for W1-A');
    assert.equal(issue.category, 'code');
    assert.ok(Array.isArray(issue.resolutionSteps) && issue.resolutionSteps.length > 0);
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
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.selfHealRound, 1);
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
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.selfHealRound, 1);
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
    const fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.selfHealRound, 1);
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

// ── Cross-category global ceiling ────────────────────────────────────────────

describe('runSelfHeal — cross-category global ceiling', () => {
  test('mixed stall → code → merge quarantines when selfHealRound reaches max', async () => {
    const t = task('W1-A', { status: 'merging', selfHealRound: 0 });
    const { group, planner } = makeSetup([t]);

    const { deps, s } = makeDeps();
    s.buildFailureRoute = 'retry';

    await runSelfHeal(group, t, planner, opts('build', { category: 'stall' }), deps);
    let fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.selfHealRound, 1);

    await runSelfHeal(group, fresh, planner, opts('build', { category: 'code' }), deps);
    fresh = group.orchestrateBoard!.tasks.find((x) => x.id === 'W1-A')!;
    assert.equal(fresh.selfHealRound, 2);

    await runSelfHeal(group, fresh, planner, opts('merge', { category: 'merge' }), deps);
    assert.equal(s.quarantineCalls.length, 1);
    assert.equal(s.fixerCalled, false);
  });
});
