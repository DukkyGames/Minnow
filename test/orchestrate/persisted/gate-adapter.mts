import {
  PersistedAfkHarness,
  delay,
  installPersistedClientDom,
  type RestartCheckpoint,
} from './_persisted-afk-harness.mts';
import type { BoardScenario } from '../../../src/dev/orchestrate-scenarios/schema.ts';

export const DEFAULT_PERSISTED_RESTART_CHECKPOINTS = [
  'after-server-ready',
  'after-fake-model-start',
  'after-board-seed',
  'after-worktree-create',
  'after_board_start',
] as const;

const CHECKPOINT_ALIASES: Record<string, RestartCheckpoint> = {
  'server-ready': 'after-server-ready',
  'fake-model-start': 'after-fake-model-start',
  'board-seed': 'after-board-seed',
  'worktree-create': 'after-worktree-create',
  'active-board': 'after_board_start',
  'after-server-ready': 'after-server-ready',
  'after-fake-model-start': 'after-fake-model-start',
  'after-board-seed': 'after-board-seed',
  'after-worktree-create': 'after-worktree-create',
  after_board_start: 'after_board_start',
};

let sharedDomInstalled = false;

type GateContext = {
  gate: 'persisted' | 'restart' | 'soak';
  scenario: BoardScenario;
  checkpoints?: string[];
};

type IterationContext = {
  seed: number;
  signal: AbortSignal;
  timeoutMs: number;
  scenario: BoardScenario & { gate?: { kind?: string; checkpoints?: string[] } };
};

type DriverResult = {
  classification:
    | 'pass'
    | 'expected_blocked'
    | 'unexpected_blocked'
    | 'product_failure'
    | 'timeout'
    | 'harness_error';
  error?: string;
  boardLog?: unknown[];
  fakeModelRequests?: unknown[];
  finalState?: unknown;
};

async function ensureSharedDom(): Promise<void> {
  if (!sharedDomInstalled) {
    installPersistedClientDom();
    sharedDomInstalled = true;
  }
  // The catalog is loaded before the gate driver, so renderer.ts can evaluate
  // dompurify while Node has no window. Initialize that shared export in place.
  const module = await import('dompurify');
  const factory = module.default as unknown as {
    (window: typeof globalThis.window): { sanitize: (...args: unknown[]) => string };
    sanitize?: (...args: unknown[]) => string;
  };
  if (typeof factory.sanitize !== 'function') {
    const configured = factory(globalThis.window);
    factory.sanitize = configured.sanitize.bind(configured);
  }
}

function requestedCheckpoints(context: GateContext, scenario: IterationContext['scenario']): string[] {
  const requested = context.checkpoints?.length
    ? context.checkpoints
    : scenario.gate?.checkpoints ?? [];
  return [...new Set(requested)];
}

function normalizeCheckpoints(requested: string[]): {
  supported: RestartCheckpoint[];
  unsupported: string[];
} {
  const supported: RestartCheckpoint[] = [];
  const unsupported: string[] = [];
  for (const checkpoint of requested) {
    const normalized = CHECKPOINT_ALIASES[checkpoint];
    if (normalized) supported.push(normalized);
    else unsupported.push(checkpoint);
  }
  return { supported: [...new Set(supported)], unsupported };
}

async function fakeModelArtifacts(harness: PersistedAfkHarness): Promise<unknown[]> {
  const result = await harness.api<{ requests?: unknown[] }>(
    'GET',
    '/api/orchestrate/board-testing/fake-model/requests?limit=200',
  );
  return result.body.requests ?? [];
}

async function boardLogArtifacts(
  harness: PersistedAfkHarness,
  groupId: string,
): Promise<unknown[]> {
  const deadline = Date.now() + 2_000;
  let events: unknown[] = [];
  while (Date.now() < deadline) {
    const result = await harness.api<{ events?: unknown[] }>(
      'GET',
      `/api/orchestrate/board-testing/board-log/tail?groupId=${encodeURIComponent(groupId)}&limit=200`,
    );
    events = result.body.events ?? [];
    if (events.length) break;
    await delay(25);
  }
  return events;
}

async function restartWithFakeModel(
  harness: PersistedAfkHarness,
  checkpoint: RestartCheckpoint,
  fakeScenario: { steps: unknown[] },
): Promise<void> {
  await harness.restart(checkpoint);
  await harness.configureFakeModel(fakeScenario);
  await harness.startFakeModel();
}

async function createRestartSmokeWorktree(harness: PersistedAfkHarness, seed: number): Promise<void> {
  const boardId = `gate-checkpoint-${seed}`;
  const integrationBranch = `minnow/gate/${seed}/integration`;
  const integration = await harness.api<{ ok?: boolean }>('POST', '/api/worktree', {
    op: 'ensure_integration',
    boardId,
    branch: integrationBranch,
    baseRef: 'HEAD',
  });
  if (integration.body.ok !== true) {
    throw new Error(`worktree checkpoint integration failed: ${integration.text}`);
  }
  const task = await harness.api<{ ok?: boolean }>('POST', '/api/worktree', {
    op: 'create',
    boardId,
    slotId: 'task-gate',
    branch: `minnow/gate/${seed}/task`,
    baseRef: integrationBranch,
  });
  if (task.body.ok !== true) {
    throw new Error(`worktree checkpoint create failed: ${task.text}`);
  }
}

/**
 * Real persisted board gate adapter used by Phase 6 commands.
 */
export async function createBoardGateDriver(context: GateContext) {
  await ensureSharedDom();
  const scenarioAdapter = await import('../../../src/dev/orchestrate-scenarios/adapters.ts');
  const fakePlan = scenarioAdapter.toFakeModelScenario(context.scenario);

  return {
    async runIteration(iteration: IterationContext): Promise<DriverResult> {
      const checkpoints = normalizeCheckpoints(requestedCheckpoints(context, iteration.scenario));
      if (checkpoints.unsupported.length) {
        return {
          classification: 'harness_error',
          error: `Unsupported persisted restart checkpoint(s): ${checkpoints.unsupported.join(', ')}`,
          finalState: {
            scenarioId: context.scenario.id,
            seed: iteration.seed,
            unsupportedCheckpoints: checkpoints.unsupported,
          },
        };
      }
      if (context.scenario.preset === 'generated') {
        return {
          classification: 'harness_error',
          error: 'Persisted board seed API does not support generated scenario graphs',
          finalState: { scenarioId: context.scenario.id, seed: iteration.seed },
        };
      }

      const harness = await PersistedAfkHarness.create();
      let restoreFetch: (() => void) | undefined;
      let sessions: typeof import('../../../src/state/sessions.ts') | undefined;
      let boardActions: typeof import('../../../src/state/orchestrate-board-actions.ts') | undefined;
      let group: NonNullable<typeof import('../../../src/state/sessions.ts').sessionState>['groups'][number] | undefined;
      let planner: NonNullable<typeof import('../../../src/state/sessions.ts').sessionState>['chats'][number] | undefined;
      let groupId = '';

      try {
        await harness.start();
        if (checkpoints.supported.includes('after-server-ready')) {
          await harness.restart('after-server-ready');
        }

        await harness.configureFakeModel(fakePlan);
        await harness.startFakeModel();
        if (checkpoints.supported.includes('after-fake-model-start')) {
          await restartWithFakeModel(harness, 'after-fake-model-start', fakePlan);
        }

        const seeded = await harness.seedAfkBoard({
          preset: context.scenario.preset,
          stableIds: true,
        });
        groupId = seeded.groupId;
        if (checkpoints.supported.includes('after-board-seed')) {
          await restartWithFakeModel(harness, 'after-board-seed', fakePlan);
        }
        if (checkpoints.supported.includes('after-worktree-create')) {
          await createRestartSmokeWorktree(harness, iteration.seed);
          await restartWithFakeModel(harness, 'after-worktree-create', fakePlan);
        }

        const { defaultToolConfig } = await import('../../../src/tools/config.ts');
        const toolConfig = defaultToolConfig();
        toolConfig.permissions.default.board_report = 'full';
        toolConfig.enabled.board_report = true;
        const toolsPut = await harness.api('PUT', '/api/config/tools', toolConfig);
        if (toolsPut.status !== 200) throw new Error(`tool config failed: ${toolsPut.text}`);

        const serverContext = await import('../../../src/headless/server-context.ts');
        restoreFetch = serverContext.installHeadlessFetch(harness.baseUrl, harness.authToken);
        const storage = await import('../../../src/config/storage-mode.ts');
        const tools = await import('../../../src/tools/config.ts');
        const toolClient = await import('../../../src/tools/client.ts');
        const providers = await import('../../../src/providers/store.ts');
        sessions = await import('../../../src/state/sessions.ts');
        boardActions = await import('../../../src/state/orchestrate-board-actions.ts');
        const { runChatTurn } = await import('../../../src/tools/loop.ts');
        const { setToolCallsMetaForTests } = await import(
          '../../../src/config/tool-calls-meta.ts'
        );
        const boardLogDisk = await import('../../../src/state/board-log-disk.ts');
        const planComplete = await import(
          '../../../src/chat/orchestrate/plan-complete-ui.ts'
        );
        const reports = await import('../../../src/agents/controller/report.ts');

        storage.setStorageModeForTests('server');
        sessions.setSessionsLazyHistoryEnabledForTests(false);
        tools.invalidateToolConfigCache();
        providers.invalidateProviderCache();
        await toolClient.detectLocalServer();
        await tools.ensureToolConfigReady();
        await sessions.loadSessionsFromStorage({ force: true });
        setToolCallsMetaForTests({ useConstrainedDecoding: false });
        boardLogDisk.initBoardLogDiskSink();
        planComplete.setOrchestratePlanCompleteWrapUpHook(async () => undefined);
        reports.setOrchestratorReportDeliverHook(async () => undefined);

        const resolveHydratedBoard = () => {
          planner = sessions!.sessionState?.chats.find((chat) => chat.id === seeded.plannerId);
          group = sessions!.sessionState?.groups.find((candidate) => candidate.id === seeded.groupId);
          if (!planner || !group?.orchestrateBoard) {
            throw new Error('seeded board did not hydrate from persisted sessions');
          }
          sessions!.sessionState!.activeBoardGroupId = undefined;
          sessions!.sessionState!.activeId = 'persisted-gate-driver';
          group.orchestrateBoard.maxConcurrentTasks = 1;
          boardActions!.setBoardIsolationMode(group, 'per-task', planner);
        };
        resolveHydratedBoard();

        let turnsInFlight = 0;
        boardActions.setBoardChatTurnRunner(async (input) => {
          turnsInFlight += 1;
          try {
            return await runChatTurn(input);
          } finally {
            turnsInFlight -= 1;
          }
        });

        boardActions.activateAfk(group!, planner!);
        if (checkpoints.supported.includes('after_board_start')) {
          group!.orchestrateBoard!.autoRunning = true;
          sessions.saveSessionsNow();
          await sessions.waitForSessionSaveForTests();
          await harness.restart('after_board_start');
          await harness.configureFakeModel(fakePlan);
          await harness.startFakeModel();
          restoreFetch();
          restoreFetch = serverContext.installHeadlessFetch(harness.baseUrl, harness.authToken);
          providers.invalidateProviderCache();
          tools.invalidateToolConfigCache();
          sessions.setSessionStateForTests(null);
          await toolClient.detectLocalServer();
          await tools.ensureToolConfigReady();
          await sessions.loadSessionsFromStorage({ force: true });
          resolveHydratedBoard();
          await boardActions.resumeBoardExecutionAfterReload(group!, planner!);
        } else {
          boardActions.startBoardAutoRun(group!, planner!);
        }

        const deadline = Date.now() + Math.max(50, iteration.timeoutMs - 2_000);
        while (Date.now() < deadline) {
          if (iteration.signal.aborted) {
            const error = new Error('iteration stopped');
            error.name = 'AbortError';
            throw error;
          }
          await boardActions.autoDelegateNext(group!, planner!);
          const tasks = group!.orchestrateBoard!.tasks;
          const terminal = tasks.every((task) =>
            ['complete', 'failed', 'blocked', 'quarantined'].includes(task.status),
          );
          if (terminal && turnsInFlight === 0 && group!.orchestrateBoard!.completionShownAt) break;
          await delay(25);
        }

        sessions.saveSessionsNow();
        await sessions.waitForSessionSaveForTests();
        const board = group!.orchestrateBoard!;
        const actualOutcome = board.tasks.every((task) => task.status === 'complete')
          ? 'passed'
          : board.tasks.every((task) =>
                ['complete', 'failed', 'blocked', 'quarantined'].includes(task.status),
              )
            ? 'blocked'
            : 'non_terminal';
        const expectedOutcome = context.scenario.expected.boardOutcome;
        const classification =
          actualOutcome === expectedOutcome
            ? expectedOutcome === 'blocked'
              ? 'expected_blocked'
              : 'pass'
            : actualOutcome === 'blocked'
              ? 'unexpected_blocked'
              : 'product_failure';

        const [boardLog, fakeModelRequests] = await Promise.all([
          boardLogArtifacts(harness, groupId),
          fakeModelArtifacts(harness),
        ]);
        return {
          classification,
          boardLog,
          fakeModelRequests,
          finalState: {
            scenarioId: context.scenario.id,
            deterministicSeed: iteration.seed,
            expectedOutcome,
            actualOutcome,
            checkpoints: checkpoints.supported,
            groupId,
            board,
          },
        };
      } catch (error) {
        let boardLog: unknown[] = [];
        let fakeModelRequests: unknown[] = [];
        if (groupId) {
          [boardLog, fakeModelRequests] = await Promise.all([
            boardLogArtifacts(harness, groupId).catch(() => []),
            fakeModelArtifacts(harness).catch(() => []),
          ]);
        }
        return {
          classification: error instanceof Error && error.name === 'AbortError'
            ? 'timeout'
            : 'harness_error',
          error: error instanceof Error ? error.message : String(error),
          boardLog,
          fakeModelRequests,
          finalState: {
            scenarioId: context.scenario.id,
            deterministicSeed: iteration.seed,
            groupId,
            serverOutput: harness.serverOutput,
          },
        };
      } finally {
        if (group?.orchestrateBoard && planner && boardActions) {
          boardActions.stopBoardAutoRun(group, planner, { reason: 'system' });
          await delay(100);
        }
        boardActions?.setBoardChatTurnRunner(null);
        if (sessions) {
          sessions.setSessionStateForTests(null);
          sessions.resetSessionPersistenceForTests();
          sessions.setSessionsLazyHistoryEnabledForTests(true);
        }
        const boardStore = await import('../../../src/state/orchestrate-board-store.ts');
        const boardLogDisk = await import('../../../src/state/board-log-disk.ts');
        const planComplete = await import(
          '../../../src/chat/orchestrate/plan-complete-ui.ts'
        );
        const reports = await import('../../../src/agents/controller/report.ts');
        const tools = await import('../../../src/tools/config.ts');
        boardStore.setBoardLogDiskSink(undefined);
        boardLogDisk.resetBoardLogDiskSinkForTests();
        planComplete.setOrchestratePlanCompleteWrapUpHook(null);
        reports.setOrchestratorReportDeliverHook(null);
        tools.setLocalServerAvailableForTests(false);
        restoreFetch?.();
        await harness.dispose();
      }
    },
  };
}
