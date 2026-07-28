/**
 * Headless board E2E — real runChatTurn + fetch interception (no scripted turn runner).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { isOrchestratePlanComplete } from '../../src/chat/orchestrate/plan-complete.ts';
import {
  checkBoardLog,
  type BoardLogCheckOptions,
} from '../../src/state/board-log-invariants.ts';
import { setBoardLogDiskSink } from '../../src/state/orchestrate-board-store.ts';
import { resetBoardLogDiskSinkForTests } from '../../src/state/board-log-disk.ts';
import {
  autoDelegateNext,
  clearTaskChatStallRestartsForTests,
  clearTaskQueuesForTests,
  clearMissingReportNudgesForTests,
  MISSING_REPORT_NUDGE_CAP,
  releaseLaunchSlotForTests,
  setBoardChatTurnRunner,
  startBoardAutoRun,
} from '../../src/state/orchestrate-board-actions.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  defaultToolConfig,
  setLocalServerAvailableForTests,
  setToolConfigForTests,
} from '../../src/tools/config.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { setToolCallsMetaForTests } from '../../src/config/tool-calls-meta.ts';
import {
  assertBoardConverged,
  assertTaskStatus,
  FLOW_FINAL_CHAT_ID,
  seedBoard,
  settleUntil,
  taskChatId,
} from './_board-flow-helpers.mts';
import { setBoardNowForTests } from '../../src/state/orchestrate-board-store.ts';
import { setStreaming } from '../../src/app-state.ts';
import { installHeadlessDom, teardownDom } from './_headless-board-dom.mts';
import {
  assertZeroUnrouted,
  installFakeApiRouter,
  type FakeApiRouterHandle,
  type FakeApiScript,
} from './_fake-api-router.mts';
import {
  DUPLICATE_TOOL_CALL_THRESHOLD,
  multiWaveHappyScript,
  quirkFixtures,
} from './_board-quirk-fixtures.mts';

const QUIRK_TASK = 'W1-A';

function installBoardHeadlessToolPermissions(): void {
  const toolConfig = defaultToolConfig();
  toolConfig.permissions.default.board_report = 'full';
  toolConfig.permissions.default.get_datetime = 'full';
  toolConfig.permissions.default.save_file = 'full';
  setToolConfigForTests(toolConfig);
}

function installHeadlessFlowEnv(): () => void {
  const prevMinnowTest = process.env.MINNOW_TEST;
  process.env.MINNOW_TEST = '1';
  setBoardNowForTests(() => 1_700_000_000_000);
  return () => {
    setBoardNowForTests(null);
    setStreaming(false);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
  };
}

function wireBoardLogMirror(): void {
  setBoardLogDiskSink((groupId, event) => {
    void fetch('/api/orchestrate/board-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, event }),
    });
  });
}

function boardLogOpts(
  taskIds: string[],
  waves: string[],
  expectFinal = false,
): BoardLogCheckOptions {
  return {
    tasks: taskIds.map((id) => ({ id, wave: id.startsWith('W2') ? 'W2' : 'W1' })),
    waveOrder: waves,
    expectFinalTest: expectFinal,
    requireTerminal: true,
  };
}

async function driveHeadlessBoard(
  script: FakeApiScript,
  spec: {
    waves: Array<{ id: string }>;
    tasks: Array<{ id: string; title: string; wave: string }>;
    finalTest?: boolean;
  },
  options?: { maxTicks?: number; allowSettleTimeout?: boolean },
): Promise<{
  group: ReturnType<typeof seedBoard>['group'];
  router: FakeApiRouterHandle;
}> {
  const { planner, group } = seedBoard({
    waves: spec.waves,
    tasks: spec.tasks,
  });

  const router = installFakeApiRouter(script);
  wireBoardLogMirror();

  const turnFlight = { inFlight: 0, install: () => {}, restore: () => {} };
  const { runChatTurn } = await import('../../src/tools/loop.ts');
  setBoardChatTurnRunner(async (input) => {
    turnFlight.inFlight += 1;
    try {
      await runChatTurn(input);
    } finally {
      turnFlight.inFlight -= 1;
    }
  });

  startBoardAutoRun(group, planner);
  await autoDelegateNext(group, planner);
  try {
    await settleUntil(group, planner, options?.maxTicks ?? 1200, { runner: turnFlight });
  } catch (err) {
    if (!options?.allowSettleTimeout) throw err;
  }

  return { group, router };
}

function assertBoardLogCaptured(
  router: FakeApiRouterHandle,
  opts: BoardLogCheckOptions,
): void {
  const events =
    router.boardLogEvents.length > 0
      ? router.boardLogEvents
      : (() => {
          throw new Error('expected board-log mirror events to be captured');
        })();
  const result = checkBoardLog(events, opts);
  assert.equal(result.ok, true, JSON.stringify(result.violations));
}

describe('board headless E2E (real runChatTurn)', () => {
  let envRestore: (() => void) | undefined;
  let router: FakeApiRouterHandle | undefined;

  beforeEach(() => {
    installHeadlessDom();
    envRestore = installHeadlessFlowEnv();
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    clearMissingReportNudgesForTests();
    clearTaskChatStallRestartsForTests();
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2, maxConcurrentTasks: 3 });
    setToolCallsMetaForTests({ useConstrainedDecoding: false });
    installBoardHeadlessToolPermissions();
    setStorageModeForTests('localStorage');
    resetBoardLogDiskSinkForTests();
  });

  afterEach(() => {
    setBoardChatTurnRunner(null);
    setBoardLogDiskSink(undefined);
    router?.restore();
    router = undefined;
    envRestore?.();
    teardownDom();
    envRestore = undefined;
    setLocalServerAvailableForTests(false);
    clearTaskQueuesForTests();
    clearMissingReportNudgesForTests();
    clearTaskChatStallRestartsForTests();
    releaseLaunchSlotForTests(FLOW_FINAL_CHAT_ID);
    setSessionStateForTests(null);
    resetAutopilotMetaCache();
    resetBoardLogDiskSinkForTests();
  });

  test('happy path: multi-wave board converges with board-log invariants', async () => {
    const script = multiWaveHappyScript();
    const { group, router: r } = await driveHeadlessBoard(script, {
      waves: [{ id: 'W1' }, { id: 'W2' }],
      tasks: [
        { id: 'W1-A', title: 'Wave one A', wave: 'W1' },
        { id: 'W1-B', title: 'Wave one B', wave: 'W1' },
        { id: 'W2-A', title: 'Wave two A', wave: 'W2' },
      ],
      finalTest: true,
    });
    router = r;

    assertTaskStatus(group, 'W1-A', 'complete');
    assertTaskStatus(group, 'W1-B', 'complete');
    assertTaskStatus(group, 'W2-A', 'complete');
    assert.ok(assertBoardConverged(group));
    assert.equal(group.orchestrateBoard?.finalTest?.status, 'passed');
    assert.ok(isOrchestratePlanComplete(group.orchestrateBoard!));

    assertBoardLogCaptured(
      router,
      boardLogOpts(['W1-A', 'W1-B', 'W2-A'], ['W1', 'W2'], true),
    );
    assertZeroUnrouted(router);
  });
});

describe('board headless quirk fixtures', () => {
  let envRestore: (() => void) | undefined;
  let router: FakeApiRouterHandle | undefined;

  beforeEach(() => {
    installHeadlessDom();
    envRestore = installHeadlessFlowEnv();
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    clearMissingReportNudgesForTests();
    clearTaskChatStallRestartsForTests();
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2, maxConcurrentTasks: 2 });
    setToolCallsMetaForTests({ useConstrainedDecoding: false });
    installBoardHeadlessToolPermissions();
    setStorageModeForTests('localStorage');
    resetBoardLogDiskSinkForTests();
  });

  afterEach(() => {
    setBoardChatTurnRunner(null);
    setBoardLogDiskSink(undefined);
    router?.restore();
    router = undefined;
    envRestore?.();
    teardownDom();
    envRestore = undefined;
    setLocalServerAvailableForTests(false);
    clearTaskQueuesForTests();
    clearMissingReportNudgesForTests();
    clearTaskChatStallRestartsForTests();
    releaseLaunchSlotForTests(FLOW_FINAL_CHAT_ID);
    setSessionStateForTests(null);
    resetAutopilotMetaCache();
    resetBoardLogDiskSinkForTests();
  });

  async function runQuirk(
    name: keyof typeof quirkFixtures,
    assertFn?: (group: ReturnType<typeof seedBoard>['group']) => void,
    spec?: {
      tasks?: Array<{ id: string; title: string; wave: string }>;
      finalTest?: boolean;
      expectFinalTestInLog?: boolean;
      autopilot?: { maxBuildAttempts?: number; maxConcurrentTasks?: number };
      allowSettleTimeout?: boolean;
      boardLogSkip?: BoardLogCheckOptions['skip'];
    },
  ): Promise<void> {
    if (spec?.autopilot) {
      setAutopilotMetaForTests({
        maxBuildAttempts: spec.autopilot.maxBuildAttempts ?? 2,
        maxConcurrentTasks: spec.autopilot.maxConcurrentTasks ?? 2,
      });
    }
    const tasks = spec?.tasks ?? [{ id: QUIRK_TASK, title: `Quirk ${name}`, wave: 'W1' }];
    const script = quirkFixtures[name](QUIRK_TASK);
    const { group, router: r } = await driveHeadlessBoard(
      script,
      {
        waves: [{ id: 'W1' }],
        tasks,
        finalTest: spec?.finalTest,
      },
      { allowSettleTimeout: spec?.allowSettleTimeout },
    );
    router = r;
    assertFn?.(group);
    const taskIds = tasks.map((t) => t.id);
    const logOpts = boardLogOpts(
      taskIds,
      ['W1'],
      spec?.expectFinalTestInLog ?? spec?.finalTest === true,
    );
    if (spec?.finalTest !== true) {
      logOpts.skip = [...(logOpts.skip ?? []), 'final-test-order'];
    }
    if (spec?.boardLogSkip?.length) {
      logOpts.skip = [...(logOpts.skip ?? []), ...spec.boardLogSkip];
    }
    assertBoardLogCaptured(router, logOpts);
    assertZeroUnrouted(router);
  }

  test('malformed tool args then recovery', async () => {
    await runQuirk('malformedToolArgs', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('board_report green tolerant outcome', async () => {
    await runQuirk('boardReportGreen', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
      const task = group.orchestrateBoard?.tasks.find((t) => t.id === QUIRK_TASK);
      assert.equal(task?.testVerdict, 'pass');
    });
  });

  test('board_report bad outcome then recovery', async () => {
    await runQuirk('boardReportBadOutcome', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('board_report blank summary then recovery', async () => {
    await runQuirk('blankSummary', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('tester prose without VERDICT — exactly two nudges', async () => {
    await runQuirk('testerProseNoVerdict', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
      const nudges = router!.boardLogEvents.filter(
        (e) => e.type === 'task_retry' && e.detail?.attemptKind === 'nudge',
      );
      assert.equal(nudges.length, 2, 'expected exactly two tester nudges');
    });
  });

  test('truncated mid-tool-call stream then recovery', async () => {
    await runQuirk('truncatedMidToolCall', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('nonexistent tool then recovery', async () => {
    await runQuirk('nonexistentTool', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('runaway tool repetition then board_report', async () => {
    await runQuirk('runawayRepetition', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
      const buildChatId = taskChatId(QUIRK_TASK, 'build');
      const datetimeCalls = router!.boardLogEvents.filter(
        (e) =>
          e.type === 'tool_call' &&
          (e.detail as { toolName?: string })?.toolName === 'get_datetime',
      );
      assert.ok(
        datetimeCalls.length >= DUPLICATE_TOOL_CALL_THRESHOLD,
        'expected repeated get_datetime tool rounds before board_report',
      );
    });
  });

  test('context exceeded on stream then in-place recover to complete', async () => {
    await runQuirk('contextExceededStreamThenRecover', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
      const task = group.orchestrateBoard?.tasks.find((t) => t.id === QUIRK_TASK);
      assert.equal(task?.buildAttempts, 1, 'one transient failure should burn one build attempt');
    });
  });

  test('LM Studio context limit error then recover', async () => {
    await runQuirk('contextExceededLmStudioThenRecover', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('upstream HTTP 400 context_length_exceeded then recover', async () => {
    await runQuirk('contextExceededPostThenRecover', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('tester context exceeded then VERDICT recover', async () => {
    await runQuirk(
      'contextExceededTesterThenRecover',
      (group) => {
        assertTaskStatus(group, QUIRK_TASK, 'complete');
        const task = group.orchestrateBoard?.tasks.find((t) => t.id === QUIRK_TASK);
        assert.equal(task?.testVerdict, 'pass');
      },
      { allowSettleTimeout: true },
    );
  });

  test('builder prose-only success without board_report nudges then recovers', async () => {
    await runQuirk('builderProseNoReport', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
      const nudges = router!.boardLogEvents.filter(
        (e) => e.type === 'task_retry' && e.detail?.attemptKind === 'nudge',
      );
      assert.equal(nudges.length, 2, 'expected two builder missing-report nudges');
    });
  });

  test('builder prose-only exhausts nudge budget then quarantines at build cap', async () => {
    await runQuirk(
      'builderProseOnlyQuarantine',
      (group) => {
        assertTaskStatus(group, QUIRK_TASK, 'quarantined');
        const nudges = router!.boardLogEvents.filter(
          (e) => e.type === 'task_retry' && e.detail?.attemptKind === 'nudge',
        );
        assert.equal(nudges.length, MISSING_REPORT_NUDGE_CAP);
      },
      { autopilot: { maxBuildAttempts: 1 }, allowSettleTimeout: true },
    );
  });

  test('board_report ok synonym completes', async () => {
    await runQuirk('boardReportOk', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('board_report success synonym completes', async () => {
    await runQuirk('boardReportSuccess', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('board_report env_blocked routes env-fixer path without silent complete', async () => {
    await runQuirk('boardReportEnvBlocked', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('board_report fail then recovery completes', async () => {
    await runQuirk('boardReportFailThenRecover', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('partially valid tool args then recovery', async () => {
    await runQuirk('partialValidToolArgs', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('truncated after tool name then recovery', async () => {
    await runQuirk('truncatedAfterToolName', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('forbidden delegate_tasks then recovery', async () => {
    await runQuirk('forbiddenDelegateTool', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('multiple tool calls in one delta then complete', async () => {
    await runQuirk('multipleToolCallsInDelta', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('wrong finish_reason then recovery', async () => {
    await runQuirk('wrongFinishReason', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('runaway mutating tools then board_report', async () => {
    await runQuirk('runawayMutatingThenReport', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('max tool turns transcript then recovery', async () => {
    await runQuirk('maxToolTurnsThenRecover', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('empty assistant stream then recovery', async () => {
    await runQuirk('emptyAssistantStream', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('duplicate board_report in one delta completes once', async () => {
    await runQuirk('duplicateBoardReportDelta', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('sibling task_id report ignored then recovery', async () => {
    await runQuirk('siblingTaskReport', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('tester VERDICT:PASS casing completes', async () => {
    await runQuirk('testerVerdictPassUpper', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('tester buried VERDICT completes', async () => {
    await runQuirk('testerVerdictBuried', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('tester board_report instead of prose VERDICT completes', async () => {
    await runQuirk('testerBoardReportInstead', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
      const task = group.orchestrateBoard?.tasks.find((t) => t.id === QUIRK_TASK);
      assert.equal(task?.testVerdict, 'pass');
    });
  });

  test('tester fail verdict then recovery completes', async () => {
    await runQuirk('testerFailThenRecover', (group) => {
      assertTaskStatus(group, QUIRK_TASK, 'complete');
    });
  });

  test('final integration prose without VERDICT does not pass silently', async () => {
    await runQuirk(
      'finalProseNoVerdict',
      (group) => {
        assert.notEqual(group.orchestrateBoard?.finalTest?.status, 'passed');
      },
      { finalTest: true, expectFinalTestInLog: false, boardLogSkip: ['final-test-order'] },
    );
  });

  test('repeated context exceeded at build cap quarantines without history wipe', async () => {
    await runQuirk(
      'contextExceededBuildCap',
      (group) => {
        assertTaskStatus(group, QUIRK_TASK, 'quarantined');
        const task = group.orchestrateBoard?.tasks.find((t) => t.id === QUIRK_TASK);
        assert.ok(task?.chatId, 'builder chat should be preserved until quarantine');
      },
      {
        autopilot: { maxBuildAttempts: 2 },
        boardLogSkip: ['quarantine-cascade'],
      },
    );
  });
});
