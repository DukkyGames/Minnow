import type {
  BoardLogViolation,
  BoardScenarioRunClassification,
  SanitizedFakeModelRequest,
} from '../api/board-testing';
import type { BoardScenario } from '../dev/orchestrate-scenarios/schema';

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

/** V1 engine is gone — Settings can still mount the runner, but iterations cannot drive a board. */
export function createProductBoardScenarioDriver(): BoardScenarioClientDriver {
  return {
    async runIteration() {
      return {
        classification: 'harness_error',
        error:
          'The V1 orchestrate engine is gone. Board scenario iterations cannot run until the V2 harness lands.',
      };
    },
    stop() {},
  };
}
