import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';

import {
  PersistedAfkHarness,
  delay,
  installPersistedClientDom,
} from './_persisted-afk-harness.mts';

describe('persisted AFK harness (real server, provider HTTP, sessions, and git)', () => {
  let harness: PersistedAfkHarness;

  before(async () => {
    harness = await PersistedAfkHarness.create();
    await harness.start();
  });

  after(async () => {
    await harness?.dispose();
  });

  test('persists seeded sessions across restart and serves real worktree APIs', async () => {
    const unauthorized = await fetch(`${harness.baseUrl}/api/config/sessions`);
    assert.equal(unauthorized.status, 401, 'real server must enforce its per-boot token');

    await harness.configureFakeModel({ steps: [] });
    await harness.startFakeModel();
    const seeded = await harness.seedAfkBoard();

    const sessionsBefore = await harness.api<{
      chats: Array<{ id: string }>;
      groups: Array<{ id: string }>;
    }>('GET', '/api/config/sessions');
    assert.equal(sessionsBefore.status, 200);
    assert.ok(sessionsBefore.body.chats.some((chat) => chat.id === seeded.plannerId));
    assert.ok(sessionsBefore.body.groups.some((group) => group.id === seeded.groupId));

    const boardId = 'persisted-api-smoke';
    const integrationBranch = 'minnow/test/persisted-api-smoke/integration';
    const ensured = await harness.api<{ ok?: boolean; path?: string }>(
      'POST',
      '/api/worktree',
      {
        op: 'ensure_integration',
        boardId,
        branch: integrationBranch,
        baseRef: 'HEAD',
      },
    );
    assert.equal(ensured.status, 200);
    assert.equal(ensured.body.ok, true, ensured.text);
    assert.ok(ensured.body.path);

    const created = await harness.api<{ ok?: boolean; path?: string; created?: boolean }>(
      'POST',
      '/api/worktree',
      {
        op: 'create',
        boardId,
        slotId: 'task-W1-A',
        branch: 'minnow/test/persisted-api-smoke/task-W1-A',
        baseRef: integrationBranch,
      },
    );
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true, created.text);
    assert.equal(created.body.created, true);
    assert.ok(created.body.path);
    assert.equal(
      (await fs.stat(created.body.path!)).isDirectory(),
      true,
      `worktree API returned a non-directory path: ${created.body.path}`,
    );

    const tokenBeforeRestart = harness.authToken;
    await harness.restart('after-worktree-create');
    assert.notEqual(harness.authToken, tokenBeforeRestart, 'restart must rotate auth token');

    const sessionsAfter = await harness.api<{
      chats: Array<{ id: string }>;
      groups: Array<{ id: string }>;
    }>('GET', '/api/config/sessions');
    assert.equal(sessionsAfter.status, 200);
    assert.ok(sessionsAfter.body.chats.some((chat) => chat.id === seeded.plannerId));
    assert.ok(sessionsAfter.body.groups.some((group) => group.id === seeded.groupId));

    const listed = await harness.api<{
      ok?: boolean;
      output?: string;
    }>('POST', '/api/worktree', { op: 'list' });
    assert.equal(listed.body.ok, true, listed.text);
    assert.match(
      listed.body.output ?? '',
      /refs\/heads\/minnow\/test\/persisted-api-smoke\/task-W1-A/,
    );
  });

  test('drives a persisted quick board in AFK mode through real runChatTurn', async () => {
    await harness.configureFakeModel({ steps: [] });
    await harness.startFakeModel();
    const seeded = await harness.seedAfkBoard();

    // happy-dom must exist before the first production client import: dompurify
    // binds to the ambient window when the markdown renderer module is evaluated.
    const restoreDom = installPersistedClientDom();
    const { defaultToolConfig } = await import('../../../src/tools/config.ts');
    const toolConfig = defaultToolConfig();
    toolConfig.permissions.default.board_report = 'full';
    toolConfig.enabled.board_report = true;
    const toolsPut = await harness.api('PUT', '/api/config/tools', toolConfig);
    assert.equal(toolsPut.status, 200, toolsPut.text);

    const previousMinnowTest = process.env.MINNOW_TEST;
    process.env.MINNOW_TEST = '1';

    const { installHeadlessFetch } = await import('../../../src/headless/server-context.ts');
    const restoreFetch = installHeadlessFetch(harness.baseUrl, harness.authToken);
    const { detectConfigServer, setStorageModeForTests } = await import(
      '../../../src/config/storage-mode.ts'
    );
    const { detectLocalServer } = await import('../../../src/tools/client.ts');
    const {
      ensureToolConfigReady,
      invalidateToolConfigCache,
      setLocalServerAvailableForTests,
    } = await import('../../../src/tools/config.ts');
    const sessions = await import('../../../src/state/sessions.ts');
    const {
      activateAfk,
      autoDelegateNext,
      clearTaskChatStallRestartsForTests,
      clearTaskQueuesForTests,
      setBoardChatTurnRunner,
      setBoardIsolationMode,
      startBoardAutoRun,
      stopBoardAutoRun,
    } = await import('../../../src/state/orchestrate-board-actions.ts');
    const { runChatTurn } = await import('../../../src/tools/loop.ts');
    const { setToolCallsMetaForTests } = await import('../../../src/config/tool-calls-meta.ts');
    const { initBoardLogDiskSink, resetBoardLogDiskSinkForTests } = await import(
      '../../../src/state/board-log-disk.ts'
    );
    const { setBoardLogDiskSink } = await import('../../../src/state/orchestrate-board-store.ts');
    const { setOrchestratePlanCompleteWrapUpHook } = await import(
      '../../../src/chat/orchestrate/plan-complete-ui.ts'
    );
    const { setOrchestratorReportDeliverHook } = await import(
      '../../../src/agents/controller/report.ts'
    );
    let drivenGroup: NonNullable<typeof sessions.sessionState>['groups'][number] | undefined;
    let drivenPlanner: NonNullable<typeof sessions.sessionState>['chats'][number] | undefined;

    try {
      setStorageModeForTests('server');
      sessions.setSessionsLazyHistoryEnabledForTests(false);
      invalidateToolConfigCache();
      assert.equal(await detectConfigServer(), 'server');
      assert.equal(await detectLocalServer(), true);
      await ensureToolConfigReady();
      await sessions.loadSessionsFromStorage({ force: true });
      setToolCallsMetaForTests({ useConstrainedDecoding: false });
      initBoardLogDiskSink();

      const planner = sessions.sessionState?.chats.find((chat) => chat.id === seeded.plannerId);
      const group = sessions.sessionState?.groups.find((candidate) => candidate.id === seeded.groupId);
      assert.ok(planner, 'seeded planner must hydrate from the real sessions API');
      assert.ok(group?.orchestrateBoard, 'seeded board must hydrate from the real sessions API');
      drivenGroup = group;
      drivenPlanner = planner;
      sessions.sessionState!.activeBoardGroupId = undefined;
      sessions.sessionState!.activeId = 'headless-persisted-driver';
      group.orchestrateBoard.maxConcurrentTasks = 1;
      setOrchestratePlanCompleteWrapUpHook(async () => undefined);
      setOrchestratorReportDeliverHook(async () => undefined);
      setBoardIsolationMode(group, 'per-task', planner);

      let turnsInFlight = 0;
      let turnsStarted = 0;
      setBoardChatTurnRunner(async (input) => {
        turnsStarted += 1;
        turnsInFlight += 1;
        try {
          return await runChatTurn(input);
        } finally {
          turnsInFlight -= 1;
        }
      });

      activateAfk(group, planner);
      startBoardAutoRun(group, planner);

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await autoDelegateNext(group, planner);
        const tasks = group.orchestrateBoard.tasks;
        if (
          tasks.every((task) => task.status === 'complete') &&
          turnsInFlight === 0 &&
          Boolean(group.orchestrateBoard.completionShownAt)
        ) {
          break;
        }
        await delay(25);
      }
      sessions.saveSessionsNow();
      await sessions.waitForSessionSaveForTests();

      assert.equal(group.orchestrateBoard.handsOff, true);
      assert.ok(turnsStarted >= 6, `expected builder + tester turns, observed ${turnsStarted}`);
      assert.deepEqual(
        group.orchestrateBoard.tasks.map((task) => [task.id, task.status]),
        [
          ['W1-A', 'complete'],
          ['W1-B', 'complete'],
          ['W1-C', 'complete'],
        ],
      );
      assert.ok(group.orchestrateBoard.completionShownAt, 'board must reach completion handling');
      const requests = await harness.api<{
        requests?: Array<{ context?: { role?: string; taskId?: string } }>;
      }>('GET', '/api/orchestrate/board-testing/fake-model/requests?limit=50');
      assert.equal(requests.status, 200);
      assert.ok(
        requests.body.requests?.some((request) => request.context?.role === 'builder'),
        'real fake provider must observe builder HTTP requests',
      );
      assert.ok(
        requests.body.requests?.some((request) => request.context?.role === 'tester'),
        'real fake provider must observe tester HTTP requests',
      );

      const persisted = await harness.api<{
        groups: Array<{
          id: string;
          orchestrateBoard?: { handsOff?: boolean; tasks?: Array<{ status?: string }> };
        }>;
      }>('GET', '/api/config/sessions');
      const persistedBoard = persisted.body.groups.find((candidate) => candidate.id === seeded.groupId)
        ?.orchestrateBoard;
      assert.equal(persistedBoard?.handsOff, true);
      assert.deepEqual(
        persistedBoard?.tasks?.map((task) => task.status),
        ['complete', 'complete', 'complete'],
      );
      const worktrees = await harness.api<{ ok?: boolean; output?: string }>(
        'POST',
        '/api/worktree',
        { op: 'list' },
      );
      assert.equal(worktrees.body.ok, true, worktrees.text);
      assert.match(
        worktrees.body.output ?? '',
        new RegExp(`refs/heads/${group.orchestrateBoard.integrationBranch!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );

      let logEvents: Array<{ type?: string }> = [];
      const logDeadline = Date.now() + 5_000;
      while (Date.now() < logDeadline) {
        const tail = await harness.api<{ events?: Array<{ type?: string }> }>(
          'GET',
          `/api/orchestrate/board-testing/board-log/tail?groupId=${encodeURIComponent(seeded.groupId)}&limit=200`,
        );
        logEvents = tail.body.events ?? [];
        if (logEvents.some((event) => event.type === 'auto_start')) {
          break;
        }
        await delay(25);
      }
      assert.ok(logEvents.some((event) => event.type === 'auto_start'));
    } finally {
      if (drivenGroup?.orchestrateBoard && drivenPlanner) {
        stopBoardAutoRun(drivenGroup, drivenPlanner, { reason: 'system' });
        await delay(100);
      }
      setBoardChatTurnRunner(null);
      setOrchestratePlanCompleteWrapUpHook(null);
      setOrchestratorReportDeliverHook(null);
      setBoardLogDiskSink(undefined);
      resetBoardLogDiskSinkForTests();
      clearTaskQueuesForTests();
      clearTaskChatStallRestartsForTests();
      sessions.setSessionStateForTests(null);
      sessions.resetSessionPersistenceForTests();
      setLocalServerAvailableForTests(false);
      sessions.setSessionsLazyHistoryEnabledForTests(true);
      restoreFetch();
      restoreDom();
      if (previousMinnowTest === undefined) delete process.env.MINNOW_TEST;
      else process.env.MINNOW_TEST = previousMinnowTest;
    }
  });
});
