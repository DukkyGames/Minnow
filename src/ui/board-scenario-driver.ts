import {
  checkBoardLog,
  configureFakeModelScenario,
  fetchBoardLogTail,
  fetchFakeModelRequestTail,
  seedTestBoard,
  type BoardLogViolation,
  type BoardScenarioRunClassification,
  type SanitizedFakeModelRequest,
} from '../api/board-testing';
import type { BoardScenario } from '../dev/orchestrate-scenarios/schema';
import type { Chat, ChatGroup, OrchestrateBoardState } from '../types';

export type BoardScenarioDriverResult = {
  classification: Exclude<BoardScenarioRunClassification, 'stopped'>;
  error?: string;
  violations?: BoardLogViolation[];
  boardLog?: unknown[];
  fakeModelRequests?: SanitizedFakeModelRequest[];
  finalState?: unknown;
};

export type BoardScenarioDriverContext = {
  scenario: BoardScenario;
  iteration: number;
  seed: number;
  timeoutMs: number;
  signal: AbortSignal;
  onPhase?: (phase: string) => void;
};

export type BoardScenarioClientDriver = {
  runIteration(context: BoardScenarioDriverContext): Promise<BoardScenarioDriverResult>;
  stop(): Promise<void> | void;
};

type ActiveBoard = {
  group: ChatGroup;
  planner: Chat;
  stopBoardAutoRun: (
    group: ChatGroup,
    planner: Chat,
    options?: { reason?: 'user' | 'system' },
  ) => void;
};

function abortError(): DOMException {
  return new DOMException('Scenario run stopped', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function retryCount(board: OrchestrateBoardState, taskId: string): number | null {
  const task = board.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;
  return Math.max(
    task.selfHealRound ?? 0,
    task.testAttempts ?? 0,
    task.buildAttempts ?? 0,
    task.fixerAttempts ?? 0,
    task.stopRetries ?? 0,
  );
}

function expectedStateViolations(
  scenario: BoardScenario,
  board: OrchestrateBoardState,
): string[] {
  const violations: string[] = [];
  for (const [taskId, status] of Object.entries(scenario.expected.taskStatuses ?? {})) {
    const actual = board.tasks.find((task) => task.id === taskId)?.status;
    if (actual !== status) {
      violations.push(`Expected ${taskId} status ${status}, received ${actual ?? 'missing'}`);
    }
  }
  for (const [taskId, maximum] of Object.entries(scenario.expected.maxRetries ?? {})) {
    const actual = retryCount(board, taskId);
    if (actual == null) {
      violations.push(`Expected retry count for missing task ${taskId}`);
    } else if (actual > maximum) {
      violations.push(`Expected at most ${maximum} retries for ${taskId}, received ${actual}`);
    }
  }
  return violations;
}

export function classifyScenarioTerminalOutcome(options: {
  scenario: BoardScenario;
  actual: 'passed' | 'blocked';
  logOk: boolean;
  stateViolations: string[];
}): Exclude<BoardScenarioRunClassification, 'stopped'> {
  if (!options.logOk || options.stateViolations.length > 0) return 'product_failure';
  if (options.actual === 'blocked') {
    return options.scenario.expected.boardOutcome === 'blocked'
      ? 'expected_blocked'
      : 'unexpected_blocked';
  }
  return options.scenario.expected.boardOutcome === 'passed' ? 'pass' : 'product_failure';
}

/** Build the real renderer-side driver while keeping its heavy board modules lazy. */
export function createProductBoardScenarioDriver(): BoardScenarioClientDriver {
  let active: ActiveBoard | null = null;

  return {
    async runIteration(context) {
      const { scenario, signal } = context;
      // Leave a small submission window before the server's external-run timer expires.
      const deadline = Date.now() + Math.max(25, context.timeoutMs - 250);
      throwIfAborted(signal);
      if (scenario.preset === 'generated') {
        return {
          classification: 'harness_error',
          error: 'Generated scenario graphs are not supported by the current board seed endpoint',
        };
      }

      context.onPhase?.('configuring fake model');
      const [{ toFakeModelScenario, toScenarioValidationPlan }, sessions, boardActions, planComplete] =
        await Promise.all([
          import('../dev/orchestrate-scenarios/adapters'),
          import('../state/sessions'),
          import('../state/orchestrate-board-actions'),
          import('../chat/orchestrate/plan-complete'),
        ]);
      throwIfAborted(signal);

      const iterationScenario: BoardScenario = {
        ...scenario,
        seed: `${scenario.seed}:${context.seed}`,
      };
      await configureFakeModelScenario(toFakeModelScenario(iterationScenario), signal);

      context.onPhase?.('seeding AFK board');
      const seeded = await seedTestBoard(
        {
          preset: scenario.preset,
          mode: 'afk',
          autoStart: false,
          providerId: 'fake-board',
          modelId: 'fake-board-model',
        },
        signal,
      );
      if (!seeded.groupId || !seeded.plannerId) {
        return {
          classification: 'harness_error',
          error: 'Seed response did not include planner and board ids',
        };
      }

      context.onPhase?.('loading seeded board');
      await sessions.loadSessionsFromStorage({ force: true });
      throwIfAborted(signal);
      const group = sessions.sessionState?.groups.find((candidate) => candidate.id === seeded.groupId);
      const planner = sessions.sessionState?.chats.find(
        (candidate) => candidate.id === seeded.plannerId,
      );
      if (!group?.orchestrateBoard || !planner) {
        return {
          classification: 'harness_error',
          error: 'Seeded planner or board was not found after session reload',
        };
      }

      active = {
        group,
        planner,
        stopBoardAutoRun: boardActions.stopBoardAutoRun,
      };
      boardActions.activateAfk(group, planner);
      boardActions.startBoardAutoRun(group, planner);
      await boardActions.autoDelegateNext(group, planner);

      let actual: 'passed' | 'blocked' | null = null;
      context.onPhase?.('running board');
      while (!actual) {
        throwIfAborted(signal);
        const board = group.orchestrateBoard;
        if (!board) {
          return {
            classification: 'harness_error',
            error: 'Seeded board disappeared during execution',
          };
        }
        const planTerminal = planComplete.isOrchestratePlanComplete(board);
        const allQuarantined =
          board.tasks.length > 0 &&
          board.tasks.every((task) => task.status === 'quarantined');
        if (planTerminal && (board.terminalBlocked || allQuarantined)) {
          actual = 'blocked';
        } else if (planComplete.isOrchestrateBoardFinished(board)) {
          actual = 'passed';
        } else if (Date.now() >= deadline) {
          boardActions.stopBoardAutoRun(group, planner, { reason: 'user' });
          context.onPhase?.('timed out');
          const [requests, log] = await Promise.allSettled([
            fetchFakeModelRequestTail(200),
            fetchBoardLogTail(group.id, 500),
          ]);
          return {
            classification: 'timeout',
            error: `Board did not reach a terminal state within ${context.timeoutMs}ms`,
            ...(requests.status === 'fulfilled'
              ? { fakeModelRequests: requests.value }
              : {}),
            ...(log.status === 'fulfilled' ? { boardLog: log.value.events } : {}),
            finalState: { groupId: group.id, plannerId: planner.id, board },
          };
        } else {
          await boardActions.autoDelegateNext(group, planner);
          await delay(Math.min(250, Math.max(25, deadline - Date.now())), signal);
        }
      }

      throwIfAborted(signal);
      context.onPhase?.('validating log');
      const validationPlan = toScenarioValidationPlan(iterationScenario);
      let validation;
      try {
        validation = await checkBoardLog(
          { groupId: group.id, plan: validationPlan.boardLog },
          signal,
        );
      } catch (error) {
        const [requests, log] = await Promise.allSettled([
          fetchFakeModelRequestTail(200, signal),
          fetchBoardLogTail(group.id, 500, signal),
        ]);
        return {
          classification: 'harness_error',
          error: error instanceof Error ? error.message : 'Board log validation failed',
          ...(requests.status === 'fulfilled' ? { fakeModelRequests: requests.value } : {}),
          ...(log.status === 'fulfilled' ? { boardLog: log.value.events } : {}),
          finalState: { groupId: group.id, plannerId: planner.id, board: group.orchestrateBoard },
        };
      }

      const board = group.orchestrateBoard;
      if (!board) {
        return {
          classification: 'harness_error',
          error: 'Seeded board disappeared before result collection',
        };
      }
      const stateProblems = expectedStateViolations(iterationScenario, board);
      const classification = classifyScenarioTerminalOutcome({
        scenario: iterationScenario,
        actual,
        logOk: validation.ok,
        stateViolations: stateProblems,
      });
      const [requests, log] = await Promise.allSettled([
        fetchFakeModelRequestTail(200, signal),
        fetchBoardLogTail(group.id, 500, signal),
      ]);
      const errors = [
        ...(validation.violations ?? []).map((violation) => violation.message),
        ...stateProblems,
      ];
      context.onPhase?.('submitting result');
      return {
        classification,
        ...(errors.length ? { error: errors.join('; ') } : {}),
        violations: validation.violations ?? [],
        ...(requests.status === 'fulfilled' ? { fakeModelRequests: requests.value } : {}),
        ...(log.status === 'fulfilled' ? { boardLog: log.value.events } : {}),
        finalState: { groupId: group.id, plannerId: planner.id, board },
      };
    },

    stop() {
      if (!active) return;
      active.stopBoardAutoRun(active.group, active.planner, { reason: 'user' });
      active = null;
    },
  };
}
