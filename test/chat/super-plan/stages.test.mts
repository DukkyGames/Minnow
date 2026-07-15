/**
 * Super Plan stage helpers — review passes and UI heuristic (Phase 5).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
// review-helpers.ts has zero imports of its own, so it's safe to import
// statically here (before the mocks below) without risk of pre-loading a real
// copy of tools/client.ts or agents/orchestrator.ts through some transitive
// chain. Every other module below is a much larger file with a deep, opaque
// import graph (state/sessions.ts alone pulls in dozens of modules), and if
// ANY of them transitively touch tools/client.ts or agents/orchestrator.ts
// before mock.module runs, the mock silently never takes effect for anyone
// (no error — stages.ts just quietly gets the real, network-calling
// implementation). So everything else is imported dynamically, after the
// mocks are registered, never as a static (hoisted) import.
import {
  buildPlanReviewerTask,
  planInvolvesUi,
  SUPER_PLAN_REVIEW_PASSES,
} from '../../../src/chat/super-plan/review-helpers.ts';
import type {
  AssistantToolCallMessage,
  Message,
  ToolResultMessage,
} from '../../../src/types.ts';

let executeToolImpl: (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ content: string }> = async () => ({ content: '' });
let spawnSubAgentImpl: (
  input: Record<string, unknown>,
) => Promise<{ runId: string; status: string }> = async () => ({
  runId: 'mock-review-run',
  status: 'running',
});
let waitForSubAgentImpl: (runId: string, signal?: AbortSignal) => Promise<unknown> = async () => ({
  runId: 'mock-review-run',
  type: 'plan-reviewer',
  status: 'completed',
  summary: 'ok',
  outcome: { summary: 'ok', findings: [], artifacts: [] },
  startedAt: null,
  endedAt: null,
  toolTurns: 1,
  cancelled: false,
});

// mock.module replaces the whole module, so every named export tools/client.ts
// has must be present here — leaving one out doesn't error loudly, it silently
// breaks unrelated importers of that export (e.g. attachments/reader.ts's
// getLocalServerAvailable) and callers here quietly fall back to the real
// (network-calling) implementation instead of this mock.
mock.module('../../../src/tools/client.ts', {
  namedExports: {
    executeTool: (name: string, args: Record<string, unknown>) => executeToolImpl(name, args),
    detectLocalServer: async () => true,
    getLocalServerAvailable: () => true,
    localServerAvailable: () => true,
    refreshMcpToolCache: async () => undefined,
    refreshPluginToolCache: async () => undefined,
    getEnabledToolCatalogEntries: () => [],
    getEnabledToolDefinitions: () => [],
    getEnabledToolDefinitionsForMode: () => [],
    getEnabledToolDefinitionsForChat: () => [],
    getEnabledToolDefinitionsForSend: () => [],
  },
});

// Same trap as tools/client.ts above: orchestrator.ts is a re-export shim with
// ~20 exports (tools/loop.ts needs cancelAllForParentTurn, board-tools.ts needs
// getSubAgentRun, etc.) — an incomplete namedExports set here silently falls
// back to the real module instead of erroring, so every export must be listed.
mock.module('../../../src/agents/orchestrator.ts', {
  namedExports: {
    spawnSubAgent: (input: Record<string, unknown>) => spawnSubAgentImpl(input),
    waitForSubAgent: (runId: string, signal?: AbortSignal) => waitForSubAgentImpl(runId, signal),
    assertSubAgentRunReadableByParent: (run: unknown) => run,
    buildAggregateResult: () => ({}),
    buildSubAgentStatusPayload: () => ({}),
    cancelAllForParentTurn: () => undefined,
    cancelSubAgent: () => ({ ok: true, runId: '', status: 'cancelled' }),
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
    restartSubAgent: async () => ({ runId: '', status: 'queued' }),
    initControllerPersistence: async () => undefined,
    ensureControllerReady: async () => undefined,
  },
});

const stages = await import('../../../src/chat/super-plan/stages.ts');
const { shouldRunImpeccableStage } = await import(
  '../../../src/chat/super-plan/impeccable-stage.ts'
);
const { DEFAULT_SUPER_PLAN_CONFIG, resetSuperPlanConfigCache, setSuperPlanConfigForTests } =
  await import('../../../src/config/super-plan-meta.ts');
const { createEmptyChatObject } = await import('../../../src/state/sessions.ts');
const { createInitialSuperPlanStages, createSuperPlanState } = await import(
  '../../../src/chat/super-plan/state.ts'
);

function saveFileTurn(callId: string, path: string, resultText: string): Message[] {
  const assistant: AssistantToolCallMessage = {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: { name: 'save_file', arguments: JSON.stringify({ path, content: '# doc' }) },
      },
    ],
  };
  const tool: ToolResultMessage = { role: 'tool', tool_call_id: callId, content: resultText };
  return [assistant, tool];
}

function makeSuperPlanChat(activeStage: string, prompt = 'Add OAuth login') {
  const chat = createEmptyChatObject('sp-stages');
  chat.modeId = 'super-plan';
  chat.superPlan = createSuperPlanState(prompt);
  chat.superPlan.stages = createInitialSuperPlanStages();
  (chat.superPlan as { activeStage: string }).activeStage = activeStage;
  return chat;
}

/** Attach a completed TurnRunRecord whose output window is `[startIndex, history.length-1]`. */
function pushRunCoveringTail(chat: ReturnType<typeof makeSuperPlanChat>, startIndex: number): void {
  chat.runs = [
    {
      runId: `run-${Math.random().toString(36).slice(2)}`,
      branchId: 'branch-1',
      forkHistoryIndex: 0,
      status: 'completed',
      createdAt: Date.now(),
      snapshot: {} as unknown as import('../../../src/types.ts').TurnSnapshot,
      outputHistoryStart: startIndex,
      outputHistoryEnd: chat.history.length - 1,
    },
  ];
}

describe('planInvolvesUi heuristic', () => {
  test('returns false for backend-only text', () => {
    assert.equal(
      planInvolvesUi('Add API endpoint in server/routes.js', 'Migrate SQLite schema'),
      false,
    );
  });

  test('returns true for component and route mentions', () => {
    assert.equal(
      planInvolvesUi('Update settings page component and add #/settings route'),
      true,
    );
  });

  test('returns true for src/ui and CSS paths', () => {
    assert.equal(planInvolvesUi('Modify src/ui/mode-selector.ts and tokens.css'), true);
  });

  test('returns true for index.html', () => {
    assert.equal(planInvolvesUi('Wire new panel in index.html'), true);
  });

  test('returns false when all inputs empty', () => {
    assert.equal(planInvolvesUi(undefined, '', null), false);
  });
});

describe('shouldRunImpeccableStage', () => {
  test('mirrors planInvolvesUi on context fields', () => {
    assert.equal(
      shouldRunImpeccableStage({
        draftPlan: '# Backend only\n\nRefactor server.js',
      }),
      false,
    );
    assert.equal(
      shouldRunImpeccableStage({
        draftPlan: '# Dashboard\n\nAdd chart component in src/ui/',
      }),
      true,
    );
  });
});

describe('buildPlanReviewerTask', () => {
  test('pass 1 task includes draft plan and spec', () => {
    const task = buildPlanReviewerTask({
      pass: 1,
      draftPlan: '# My Plan\n\nWave 1 tasks…',
      spec: 'MVP: export button',
    });
    assert.ok(task.includes('pass 1'));
    assert.ok(task.includes('My Plan'));
    assert.ok(task.includes('MVP: export button'));
    assert.ok(!task.includes('Pass 1 critique'));
  });

  test('pass 2 task includes prior critique from pass 1', () => {
    const prior = '{"summary":"2 blockers","findings":[{"title":"Missing test"}]}';
    const task = buildPlanReviewerTask({
      pass: 2,
      draftPlan: '# Revised plan',
      priorCritique: prior,
    });
    assert.ok(task.includes('pass 2'));
    assert.ok(task.includes('Pass 1 critique'));
    assert.ok(task.includes(prior));
    assert.ok(task.includes('pass 1 missed'));
  });

  test('SUPER_PLAN_REVIEW_PASSES is two sequential passes', () => {
    assert.deepEqual([...SUPER_PLAN_REVIEW_PASSES], [1, 2]);
  });
});

describe('assertPlanReviewerAggregate (Fix 2: timeout aggregate mapping)', () => {
  test('maps a cancelled aggregate with error "timeout" to the friendly timeout message', () => {
    const aggregate = {
      runId: 'r1',
      type: 'plan-reviewer',
      status: 'cancelled',
      summary: '',
      outcome: { summary: '', findings: [], artifacts: [] },
      startedAt: null,
      endedAt: null,
      toolTurns: 0,
      cancelled: true,
      error: 'timeout',
    };
    assert.throws(
      () => stages.assertPlanReviewerAggregate(aggregate, 1),
      /timed out after 20 minutes/,
    );
  });

  test('other cancellation reasons still fall through to the generic failure message', () => {
    const aggregate = {
      runId: 'r1',
      type: 'plan-reviewer',
      status: 'cancelled',
      summary: '',
      outcome: { summary: '', findings: [], artifacts: [] },
      startedAt: null,
      endedAt: null,
      toolTurns: 0,
      cancelled: true,
      error: 'parent_abort',
    };
    assert.throws(
      () => stages.assertPlanReviewerAggregate(aggregate, 1),
      /failed \(parent_abort\)/,
    );
  });

  test('a completed aggregate with real content passes through unchanged', () => {
    const aggregate = {
      runId: 'r1',
      type: 'plan-reviewer',
      status: 'completed',
      summary: 'Looks solid',
      outcome: { summary: 'Looks solid', findings: [], artifacts: [] },
      startedAt: null,
      endedAt: null,
      toolTurns: 3,
      cancelled: false,
    };
    assert.equal(stages.assertPlanReviewerAggregate(aggregate, 1), aggregate);
  });
});

describe('runReviewStage pause handling (Fix 3)', () => {
  test('returns paused instead of the aggregate outcome when paused while awaiting the reviewer', async () => {
    resetSuperPlanConfigCache();
    setSuperPlanConfigForTests({ ...DEFAULT_SUPER_PLAN_CONFIG });
    executeToolImpl = async () => ({ content: '' });
    spawnSubAgentImpl = async () => ({ runId: 'review-run-paused', status: 'running' });
    waitForSubAgentImpl = async () => ({
      runId: 'review-run-paused',
      type: 'plan-reviewer',
      status: 'completed',
      summary: 'Looks solid',
      outcome: { summary: 'Looks solid', findings: [], artifacts: [] },
      startedAt: null,
      endedAt: null,
      toolTurns: 2,
      cancelled: false,
    });

    const chat = makeSuperPlanChat('review1');
    // Simulates pauseSuperPlan having fired while the reviewer sub-agent was in flight.
    chat.superPlan!.paused = true;

    const outcome = await stages.runSuperPlanStage(chat, 'review1' as never);
    assert.deepEqual(outcome, { kind: 'paused' });
    assert.equal(
      chat.superPlan!.reviewRunId,
      undefined,
      'reviewRunId is cleared once the wait settles',
    );
  });
});

describe("finalizeStreamStage draft (Fix 7: scoped to this run's own turn)", () => {
  test("errors when no save happened in the newest run's window, even though an older draft file exists", async () => {
    const chat = makeSuperPlanChat('draft2');
    const planPath = chat.superPlan!.planPath!;

    // draft1 saved successfully earlier in history...
    chat.history.push(...saveFileTurn('call-draft1', planPath, `Saved ${planPath} (100 bytes)`));
    // ...but THIS run (draft2) produced no save_file call at all.
    const thisRunStart = chat.history.length;
    chat.history.push({ role: 'assistant', content: 'Sure, updating the plan…' });
    pushRunCoveringTail(chat, thisRunStart);

    executeToolImpl = async (name, args) => {
      // The OLD file genuinely still exists — proves the failure isn't a fileExists bug.
      if (name === 'get_file_metadata' && args.path === planPath) {
        return { content: 'path: x\ntype: file\nsize: 100 bytes' };
      }
      return { content: 'Error: ENOENT: no such file or directory' };
    };

    await assert.rejects(
      () => stages.finalizeStreamStage(chat, 'draft2' as never),
      /Plan draft was not saved/,
    );
  });

  test("succeeds when this run's own window contains the save", async () => {
    const chat = makeSuperPlanChat('draft1');
    const planPath = chat.superPlan!.planPath!;
    const thisRunStart = chat.history.length;
    chat.history.push(...saveFileTurn('call-draft1', planPath, `Saved ${planPath} (100 bytes)`));
    pushRunCoveringTail(chat, thisRunStart);

    executeToolImpl = async (name, args) => {
      if (name === 'get_file_metadata' && args.path === planPath) {
        return { content: 'path: x\ntype: file\nsize: 100 bytes' };
      }
      return { content: 'Error: ENOENT: no such file or directory' };
    };

    const outcome = await stages.finalizeStreamStage(chat, 'draft1' as never);
    assert.deepEqual(outcome, { kind: 'done', artifactPath: planPath });
  });
});

describe('finalizeStreamStage spec_confirm (Fix 8: near-miss filename adoption)', () => {
  test('adopts a near-miss spec filename saved this turn into state.specPath', async () => {
    const chat = makeSuperPlanChat('spec_confirm');
    const nearMissPath = 'documentation/plans/references/build-spec.md';
    assert.notEqual(nearMissPath, chat.superPlan!.specPath);

    const thisRunStart = chat.history.length;
    chat.history.push(
      ...saveFileTurn('call-spec', nearMissPath, `Saved ${nearMissPath} (50 bytes)`),
    );
    pushRunCoveringTail(chat, thisRunStart);

    executeToolImpl = async (name, args) => {
      if (name === 'get_file_metadata' && args.path === nearMissPath) {
        return { content: 'path: x\ntype: file\nsize: 50 bytes' };
      }
      return { content: 'Error: ENOENT: no such file or directory' };
    };

    const outcome = await stages.finalizeStreamStage(chat, 'spec_confirm' as never);
    assert.deepEqual(outcome, { kind: 'blocked_user', artifactPath: nearMissPath });
    assert.equal(chat.superPlan!.specPath, nearMissPath);
  });

  test('errors when no spec save happened this turn, even if the canonical file exists', async () => {
    const chat = makeSuperPlanChat('spec_confirm');
    const canonicalPath = chat.superPlan!.specPath!;
    const thisRunStart = chat.history.length;
    chat.history.push({ role: 'assistant', content: 'Let me think about this…' });
    pushRunCoveringTail(chat, thisRunStart);

    executeToolImpl = async (name, args) => {
      // Canonical file exists from a previous attempt, but nothing was saved THIS turn.
      if (name === 'get_file_metadata' && args.path === canonicalPath) {
        return { content: 'path: x\ntype: file\nsize: 10 bytes' };
      }
      return { content: 'Error: ENOENT: no such file or directory' };
    };

    await assert.rejects(
      () => stages.finalizeStreamStage(chat, 'spec_confirm' as never),
      /Build spec was not saved/,
    );
  });
});
