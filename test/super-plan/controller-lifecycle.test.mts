/**
 * Super Plan pause/cancel/rework state transitions (controller + state helpers).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

// Mocked before any static import touches these specifiers (both are lazily
// dynamic-imported in production code specifically so tests can intercept them).
let runSuperPlanStageImpl: (
  chat: unknown,
  stageId: string,
  hooks?: unknown,
) => Promise<unknown> = async () => ({ kind: 'blocked_user' });
let finalizeStreamStageImpl: (chat: unknown, stageId: string) => Promise<unknown> = async () => ({
  kind: 'done',
});

mock.module('../../src/chat/super-plan/stages.ts', {
  namedExports: {
    runSuperPlanStage: (chat: unknown, stageId: string, hooks?: unknown) =>
      runSuperPlanStageImpl(chat, stageId, hooks),
    finalizeStreamStage: (chat: unknown, stageId: string) =>
      finalizeStreamStageImpl(chat, stageId),
  },
});

// mock.module replaces the whole module. Super Plan abort dynamically
// imports agents/orchestrator.ts; every real export the import graph
// reads must be present here or the mock throws
// (SyntaxError: does not provide an export named '…').
let cancelSubAgentCalls: Array<{ runId: string; reason: string }> = [];
mock.module('../../src/agents/orchestrator.ts', {
  namedExports: {
    cancelSubAgent: (runId: string, reason = 'cancelled') => {
      cancelSubAgentCalls.push({ runId, reason });
      return { ok: true, runId, status: 'cancelled' as const };
    },
    assertSubAgentRunReadableByParent: (run: unknown) => run,
    buildAggregateResult: () => ({}),
    buildSubAgentStatusPayload: () => ({}),
    cancelAllForParentTurn: () => undefined,
    deriveSubAgentTerminalReason: () => undefined,
    formatAggregateResult: () => '{}',
    formatSubAgentListToolResult: () => '{}',
    formatSubAgentListToolResultForChat: () => '{}',
    getRunToolCallFingerprint: () => '',
    getSubAgentRun: () => undefined,
    listActiveSubAgentRuns: () => [],
    listSubAgentRunsForParentChat: () => [],
    listSubAgentRunsForParentTurn: () => [],
    recordToolCallForRun: () => undefined,
    resetSubAgentOrchestrator: () => undefined,
    resetSubAgentController: () => undefined,
    restartSubAgent: async () => ({ runId: '', status: 'queued' }),
    spawnSubAgent: async () => ({ runId: '', status: 'queued' }),
    waitForSubAgent: async () => ({}),
    initControllerPersistence: async () => undefined,
    ensureControllerReady: async () => undefined,
    subscribeSubAgentRuns: () => () => undefined,
    subscribeSubAgentDeliver: () => () => undefined,
    hydrateSubAgentRunsForParentChat: async () => undefined,
    hydrateSubAgentTranscript: async () => undefined,
    honestTerminalSummary: () => '',
    lastNonSystemPreview: () => '',
    rehydrateLiveParentSubAgents: async () => undefined,
    adoptSubAgentRunForTests: () => undefined,
    setSubAgentApiFetchForTests: () => undefined,
    setSubAgentOpenStreamForTests: () => undefined,
    subAgentRunFromFold: () => ({}),
  },
});

const {
  advanceSuperPlan,
  cancelSuperPlan,
  isSuperPlanStalled,
  onSuperPlanStreamEnd,
  pauseSuperPlan,
  resetSuperPlanControllerForTests,
  skipSuperPlanStage,
  startSuperPlan,
} = await import('../../src/chat/super-plan/controller.ts');
const {
  createInitialSuperPlanStages,
  createSuperPlanState,
  markSuperPlanStageStatus,
  resetSuperPlanStage,
  rewindSuperPlanStages,
  setSuperPlanActiveStage,
} = await import('../../src/chat/super-plan/state.ts');
const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const { defaultSessionState } = await import('../../src/config/defaults.ts');
const { streamingChatIds } = await import('../../src/app-state.ts');
const { DEFAULT_SUPER_PLAN_CONFIG, setSuperPlanConfigForTests } = await import(
  '../../src/config/super-plan-meta.ts'
);

// advanceSuperPlan/getSuperPlanConfigSync read this cache; seed it so config
// loading never falls through to a real localStorage/network call (neither
// exists in this runner) and throws past the mocks below.
setSuperPlanConfigForTests({ ...DEFAULT_SUPER_PLAN_CONFIG });

function makeChat(activeStage: Parameters<typeof rewindSuperPlanStages>[1] = 'grill') {
  const chat = createEmptyChatObject('sp-lifecycle');
  chat.modeId = 'super-plan';
  chat.superPlan = createSuperPlanState('Add OAuth login');
  chat.superPlan.stages = createInitialSuperPlanStages();
  chat.superPlan.activeStage = activeStage;
  return chat;
}

/** Register a chat so findChatById(chat.id) resolves it (onSuperPlanStreamEnd needs this). */
function registerChatForLookup(chat: ReturnType<typeof makeChat>): void {
  const state = defaultSessionState();
  state.chats = [chat as unknown as (typeof state.chats)[number]];
  state.activeId = chat.id;
  setSessionStateForTests(state);
}

async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Super Plan stage reset ───────────────────────────────────────────────────

describe('Super Plan stage reset', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('resetSuperPlanStage fully replaces the record (no stale error/artifact)', () => {
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'error', {
      error: 'boom',
      artifactPath: 'documentation/plans/x.md',
    });
    resetSuperPlanStage(chat, 'draft1');
    const record = chat.superPlan!.stages.draft1;
    assert.equal(record.status, 'pending');
    assert.equal(record.error, undefined);
    assert.equal(record.artifactPath, undefined);
    assert.equal(record.startedAt, undefined);
    assert.equal(record.finishedAt, undefined);
  });
});

// ── Super Plan rewind ────────────────────────────────────────────────────────

describe('Super Plan rewind', () => {
  test('rewindSuperPlanStages resets the target and all later stages', () => {
    const chat = makeChat('finalize');
    for (const stage of ['grill', 'spec_confirm', 'research', 'draft1', 'review1'] as const) {
      markSuperPlanStageStatus(chat, stage, 'done');
    }
    chat.superPlan!.review1Critique = 'critique';
    chat.superPlan!.researchId = 'r-123';
    chat.superPlan!.paused = true;

    rewindSuperPlanStages(chat, 'draft1');

    const sp = chat.superPlan!;
    assert.equal(sp.activeStage, 'draft1');
    assert.equal(sp.paused, false);
    assert.equal(sp.stages.grill.status, 'done');
    assert.equal(sp.stages.research.status, 'done');
    assert.equal(sp.stages.draft1.status, 'pending');
    assert.equal(sp.stages.review1.status, 'pending');
    assert.equal(sp.stages.finalize.status, 'pending');
    assert.equal(sp.review1Critique, undefined);
    assert.equal(sp.researchId, 'r-123', 'rewind after research keeps the research run');
  });

  test('rewinding to research clears the stale research id', () => {
    const chat = makeChat('draft1');
    chat.superPlan!.researchId = 'r-123';
    rewindSuperPlanStages(chat, 'research');
    assert.equal(chat.superPlan!.researchId, undefined);
    assert.equal(chat.superPlan!.activeStage, 'research');
  });
});

// ── Super Plan pause ─────────────────────────────────────────────────────────

describe('Super Plan pause and cancel', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('pauseSuperPlan marks the pipeline paused and stalled', () => {
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'running');
    pauseSuperPlan(chat);
    assert.equal(chat.superPlan!.paused, true);
    assert.equal(chat.superPlan!.cancelled, undefined);
    assert.equal(isSuperPlanStalled(chat), true);
  });

  test('cancelSuperPlan is terminal and marks the active stage', () => {
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'running');
    cancelSuperPlan(chat);
    assert.equal(chat.superPlan!.cancelled, true);
    assert.equal(chat.superPlan!.paused, false);
    assert.equal(chat.superPlan!.stages.draft1.status, 'error');
    assert.equal(chat.superPlan!.stages.draft1.error, 'Cancelled by user');
    assert.equal(isSuperPlanStalled(chat), false);
  });

  test('isSuperPlanStalled is false at user checkpoints and after completion', () => {
    const blocked = makeChat('spec_confirm');
    markSuperPlanStageStatus(blocked, 'spec_confirm', 'blocked_user');
    assert.equal(isSuperPlanStalled(blocked), false);

    const finished = makeChat('present');
    markSuperPlanStageStatus(finished, 'present', 'done');
    assert.equal(isSuperPlanStalled(finished), false);

    const errored = makeChat('research');
    markSuperPlanStageStatus(errored, 'research', 'error', { error: 'Research timed out' });
    assert.equal(isSuperPlanStalled(errored), true);
  });
});

// ── Super Plan ───────────────────────────────────────────────────────────────

describe('Super Plan review cancellation (Fix 3: pause/cancel reach the reviewer sub-agent)', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('cancelSuperPlan cancels the in-flight reviewer sub-agent run', async () => {
    cancelSubAgentCalls = [];
    const chat = makeChat('review1');
    markSuperPlanStageStatus(chat, 'review1', 'running');
    chat.superPlan!.reviewRunId = 'sub-agent-run-123';

    cancelSuperPlan(chat);
    await settle();

    assert.deepEqual(cancelSubAgentCalls, [
      { runId: 'sub-agent-run-123', reason: 'parent_abort' },
    ]);
  });

  test('pauseSuperPlan cancels the in-flight reviewer sub-agent run', async () => {
    cancelSubAgentCalls = [];
    const chat = makeChat('review1');
    markSuperPlanStageStatus(chat, 'review1', 'running');
    chat.superPlan!.reviewRunId = 'sub-agent-run-456';

    pauseSuperPlan(chat);
    await settle();

    assert.deepEqual(cancelSubAgentCalls, [
      { runId: 'sub-agent-run-456', reason: 'parent_abort' },
    ]);
  });

  test('pause/cancel without an in-flight reviewer run does not call cancelSubAgent', async () => {
    cancelSubAgentCalls = [];
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'running');

    pauseSuperPlan(chat);
    await settle();

    assert.deepEqual(cancelSubAgentCalls, []);
  });
});

// ── advanceSuperPlan max-tool-turns ──────────────────────────────────────────

describe('advanceSuperPlan max-tool-turns hint (Fix 5)', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('appends the tool-turn cap hint when the newest run hit the cap and the stage failed to save', async () => {
    runSuperPlanStageImpl = async (chatArg) => {
      const chat = chatArg as ReturnType<typeof makeChat>;
      chat.history.push({ role: 'user', content: 'go' });
      chat.runs = [
        {
          runId: 'run-cap',
          branchId: 'branch-cap',
          forkHistoryIndex: 0,
          status: 'completed',
          createdAt: Date.now(),
          snapshot: {} as unknown as import('../../src/types.ts').TurnSnapshot,
          outputHistoryStart: chat.history.length - 1,
          outputHistoryEnd: chat.history.length - 1,
          endReason: 'max_tool_turns',
        },
      ];
      return { kind: 'await_stream' };
    };
    finalizeStreamStageImpl = async () => {
      throw new Error(
        'Plan draft was not saved to documentation/plans/add-oauth-login.md. Retry the stage to draft it again.',
      );
    };

    const chat = makeChat('draft1');
    await advanceSuperPlan(chat);

    assert.equal(chat.superPlan!.stages.draft1.status, 'error');
    assert.match(chat.superPlan!.stages.draft1.error ?? '', /Plan draft was not saved/);
    assert.match(
      chat.superPlan!.stages.draft1.error ?? '',
      /tool-turn cap.*Settings.*Tools.*max tool turns/,
    );
  });

  test('does not append the hint when the run finished normally (no endReason)', async () => {
    runSuperPlanStageImpl = async (chatArg) => {
      const chat = chatArg as ReturnType<typeof makeChat>;
      chat.history.push({ role: 'user', content: 'go' });
      chat.runs = [
        {
          runId: 'run-normal',
          branchId: 'branch-normal',
          forkHistoryIndex: 0,
          status: 'completed',
          createdAt: Date.now(),
          snapshot: {} as unknown as import('../../src/types.ts').TurnSnapshot,
          outputHistoryStart: chat.history.length - 1,
          outputHistoryEnd: chat.history.length - 1,
        },
      ];
      return { kind: 'await_stream' };
    };
    finalizeStreamStageImpl = async () => {
      throw new Error('Plan draft was not saved to documentation/plans/add-oauth-login.md.');
    };

    const chat = makeChat('draft1');
    await advanceSuperPlan(chat);

    assert.equal(chat.superPlan!.stages.draft1.status, 'error');
    assert.doesNotMatch(chat.superPlan!.stages.draft1.error ?? '', /tool-turn cap/);
  });

  test('surfaces the failed turn error message on the stage record', async () => {
    runSuperPlanStageImpl = async (chatArg) => {
      const chat = chatArg as ReturnType<typeof makeChat>;
      chat.history.push({ role: 'user', content: 'go' });
      chat.runs = [
        {
          runId: 'run-fail',
          branchId: 'branch-fail',
          forkHistoryIndex: 0,
          status: 'failed',
          createdAt: Date.now(),
          snapshot: {} as unknown as import('../../src/types.ts').TurnSnapshot,
          errorMessage: 'Could not complete this reply: Model not loaded',
        },
      ];
      return { kind: 'await_stream' };
    };

    const chat = makeChat('draft1');
    await advanceSuperPlan(chat);

    assert.equal(chat.superPlan!.stages.draft1.status, 'error');
    assert.match(chat.superPlan!.stages.draft1.error ?? '', /Draft 1 turn failed/);
    assert.match(chat.superPlan!.stages.draft1.error ?? '', /Model not loaded/);
  });
});

// ── onSuperPlanStreamEnd stream-end ──────────────────────────────────────────

describe('onSuperPlanStreamEnd stream-end ordering (Fix 9)', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('proceeds once the streaming flag clears, even though it read true synchronously', async () => {
    runSuperPlanStageImpl = async () => ({ kind: 'blocked_user' });
    finalizeStreamStageImpl = async () => ({ kind: 'done' });

    const chat = makeChat('present');
    registerChatForLookup(chat);

    // Mirrors src/tools/loop.ts: notifyChatStreamEnded fires while the chat is
    // still marked streaming; setStreaming(false) runs synchronously right after.
    streamingChatIds.add(chat.id);
    const done = onSuperPlanStreamEnd(chat.id);
    assert.equal(
      streamingChatIds.has(chat.id),
      true,
      'flag is still true at the moment stream-end fires',
    );
    streamingChatIds.delete(chat.id);

    await done;

    assert.equal(
      chat.superPlan!.stages.present.status,
      'running',
      'advanceSuperPlan ran once the deferral let it observe the cleared flag',
    );
  });
});

// ── skipSuperPlanStage during ────────────────────────────────────────────────

describe('skipSuperPlanStage during grill (MIN-442)', () => {
  test.after(() => {
    resetSuperPlanControllerForTests();
    runSuperPlanStageImpl = async () => ({ kind: 'blocked_user' });
    finalizeStreamStageImpl = async () => ({ kind: 'done' });
  });

  test('skipping an in-flight interview does not pause the pipeline', async () => {
    let releaseGrill!: () => void;
    const grillStarted = new Promise<void>((resolve) => {
      releaseGrill = resolve;
    });

    runSuperPlanStageImpl = async (chatArg, stageId) => {
      const chat = chatArg as ReturnType<typeof makeChat>;
      if (stageId !== 'grill') {
        return { kind: 'blocked_user' };
      }
      releaseGrill();
      await new Promise((resolve) => setTimeout(resolve, 30));
      chat.history.push({ role: 'user', content: 'interview' });
      chat.runs = [
        {
          runId: 'run-skipped-grill',
          branchId: 'branch-skipped-grill',
          forkHistoryIndex: 0,
          status: 'stopped',
          createdAt: Date.now(),
          snapshot: {} as unknown as import('../../src/types.ts').TurnSnapshot,
          outputHistoryStart: chat.history.length - 1,
          outputHistoryEnd: chat.history.length - 1,
        },
      ];
      return { kind: 'await_stream' };
    };
    finalizeStreamStageImpl = async () => ({ kind: 'done' });

    const chat = makeChat('grill');
    const advancePromise = advanceSuperPlan(chat);
    await grillStarted;
    await skipSuperPlanStage(chat);
    await advancePromise;

    assert.equal(chat.superPlan!.paused, false, 'skip interview must not pause');
    assert.equal(chat.superPlan!.activeStage, 'spec_confirm');
    assert.equal(chat.superPlan!.stages.grill.status, 'done');
    assert.equal(chat.superPlan!.stages.spec_confirm.status, 'running');
  });

  test('skipSuperPlanStage from a pending grill advances without pausing', async () => {
    runSuperPlanStageImpl = async () => ({ kind: 'blocked_user' });

    const chat = makeChat('grill');
    await skipSuperPlanStage(chat);

    assert.equal(chat.superPlan!.activeStage, 'spec_confirm');
    assert.equal(chat.superPlan!.paused, false);
    assert.equal(chat.superPlan!.stages.grill.status, 'done');
    assert.equal(chat.superPlan!.stages.spec_confirm.status, 'running');
  });
});

// ── advanceSuperPlan post-interview ──────────────────────────────────────────

describe('advanceSuperPlan post-interview recovery', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('does not pause when a newer stopped follow-up run races the grill stage', async () => {
    runSuperPlanStageImpl = async (chatArg, stageId) => {
      const chat = chatArg as ReturnType<typeof makeChat>;
      if (stageId === 'grill') {
        chat.history.push({ role: 'user', content: 'grill' });
        const now = Date.now();
        chat.runs = [
          {
            runId: 'run-grill',
            branchId: 'branch-grill',
            forkHistoryIndex: 0,
            status: 'completed',
            createdAt: now - 100,
            snapshot: {} as unknown as import('../../src/types.ts').TurnSnapshot,
            outputHistoryStart: chat.history.length - 1,
            outputHistoryEnd: chat.history.length - 1,
          },
          {
            runId: 'run-flush',
            branchId: 'branch-flush',
            forkHistoryIndex: 0,
            status: 'stopped',
            createdAt: now,
            snapshot: {} as unknown as import('../../src/types.ts').TurnSnapshot,
          },
        ];
        return { kind: 'await_stream' };
      }
      return { kind: 'blocked_user' };
    };
    finalizeStreamStageImpl = async (_chat, stageId) =>
      stageId === 'grill' ? { kind: 'done' } : { kind: 'blocked_user' };

    const chat = makeChat('grill');
    await advanceSuperPlan(chat);

    assert.ok(!chat.superPlan!.paused);
    assert.equal(chat.superPlan!.stages.grill.status, 'done');
    assert.equal(chat.superPlan!.activeStage, 'spec_confirm');
  });

  test('onSuperPlanStreamEnd advances when grill finished and spec_confirm is still pending', async () => {
    runSuperPlanStageImpl = async () => ({ kind: 'blocked_user' });

    const chat = makeChat('grill');
    markSuperPlanStageStatus(chat, 'grill', 'done');
    setSuperPlanActiveStage(chat, 'spec_confirm');
    registerChatForLookup(chat);

    await onSuperPlanStreamEnd(chat.id);
    await settle(30);

    assert.equal(chat.superPlan!.stages.grill.status, 'done');
    assert.equal(chat.superPlan!.activeStage, 'spec_confirm');
    assert.notEqual(chat.superPlan!.stages.spec_confirm.status, 'pending');
    assert.ok(!chat.superPlan!.paused);
  });
});

describe('startSuperPlan reuse guard', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('does not replace a live pipeline that is running a different prompt', async () => {
    runSuperPlanStageImpl = async () => ({ kind: 'blocked_user' });
    const chat = makeChat('grill');
    chat.superPlan!.stages.grill.status = 'running';
    const slug = chat.superPlan!.slug;
    const startedAt = chat.superPlan!.runStartedAt;
    registerChatForLookup(chat);

    await startSuperPlan(chat, 'A completely different brief');

    assert.equal(chat.superPlan!.prompt, 'Add OAuth login');
    assert.equal(chat.superPlan!.slug, slug);
    assert.equal(chat.superPlan!.runStartedAt, startedAt);
  });

  test('restarts a finished pipeline on the same chat', async () => {
    runSuperPlanStageImpl = async () => ({ kind: 'blocked_user' });
    const chat = makeChat('present');
    markSuperPlanStageStatus(chat, 'present', 'done');
    const oldSlug = chat.superPlan!.slug;
    registerChatForLookup(chat);

    await startSuperPlan(chat, 'Plan the next feature');
    await settle(30);

    assert.equal(chat.superPlan!.prompt, 'Plan the next feature');
    assert.notEqual(chat.superPlan!.slug, oldSlug);
    assert.equal(chat.superPlan!.activeStage, 'grill');
  });
});
