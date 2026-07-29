import {
  parseBoardScenario,
  validateScenarioCatalog,
  type BoardScenario,
  type ScenarioFault,
} from './schema.ts';

export interface BoardScenarioMetadata {
  id: string;
  family: string;
  description: string;
  preset: BoardScenario['preset'];
  executionMode: BoardScenario['executionMode'];
  expectedOutcome: BoardScenario['expected']['boardOutcome'];
  faultCount: number;
  tags: string[];
}

function reportFault(
  id: string,
  role: 'builder' | 'tester',
  response: 'builder_report_missing' | 'tester_verdict_fail',
  expectedRecovery: ScenarioFault['expectedRecovery'],
  repeat = false,
): ScenarioFault {
  return {
    id,
    boundary: 'report_contract',
    target: {
      role,
      phase: role === 'builder' ? 'build' : 'test',
      taskId: 'W1-A',
    },
    trigger: { kind: 'occurrence', occurrence: 1 },
    action: { kind: 'respond', response },
    repeat,
    expectedRecovery,
  };
}

const BUILTIN_SCENARIOS = validateScenarioCatalog([
  {
    id: 'happy.quick',
    family: 'happy',
    description: 'Quick preset completes without injected faults.',
    preset: 'quick',
    executionMode: 'afk',
    seed: 'happy.quick.v1',
    expected: { boardOutcome: 'passed' },
    faults: [],
    tags: ['baseline', 'fast'],
  },
  {
    id: 'happy.smoke',
    family: 'happy',
    description: 'Multi-wave smoke preset completes without injected faults.',
    preset: 'smoke',
    executionMode: 'afk',
    seed: 'happy.smoke.v1',
    expected: { boardOutcome: 'passed' },
    faults: [],
    tags: ['baseline', 'multi-wave'],
  },
  {
    id: 'report.builder-missing-recover',
    family: 'report-contract',
    description: 'A builder omits its first report and recovers after a deterministic nudge.',
    preset: 'quick',
    executionMode: 'afk',
    seed: 'report.builder-missing-recover.v1',
    expected: {
      boardOutcome: 'passed',
      maxRetries: { 'W1-A': 1 },
    },
    faults: [
      reportFault(
        'missing-builder-report-once',
        'builder',
        'builder_report_missing',
        'nudge',
      ),
    ],
    tags: ['recoverable', 'report-contract'],
  },
  {
    id: 'report.builder-missing-terminal',
    family: 'report-contract',
    description: 'A builder repeatedly omits its report until bounded policy blocks the board.',
    preset: 'quick',
    executionMode: 'afk',
    seed: 'report.builder-missing-terminal.v1',
    expected: { boardOutcome: 'blocked' },
    faults: [
      reportFault(
        'missing-builder-report-repeated',
        'builder',
        'builder_report_missing',
        'quarantine',
        true,
      ),
    ],
    tags: ['terminal', 'report-contract'],
  },
  {
    id: 'verdict.tester-recover',
    family: 'tester-verdict',
    description: 'A tester fails once, then the task rebuilds and passes verification.',
    preset: 'quick',
    executionMode: 'afk',
    seed: 'verdict.tester-recover.v1',
    expected: {
      boardOutcome: 'passed',
      maxRetries: { 'W1-A': 1 },
    },
    faults: [
      reportFault(
        'tester-fail-once',
        'tester',
        'tester_verdict_fail',
        'retry_build',
      ),
    ],
    tags: ['recoverable', 'tester-verdict'],
  },
]);

const SCENARIOS_BY_ID = new Map(BUILTIN_SCENARIOS.map((scenario) => [scenario.id, scenario]));

function metadataFor(scenario: BoardScenario): BoardScenarioMetadata {
  return {
    id: scenario.id,
    family: scenario.family,
    description: scenario.description,
    preset: scenario.preset,
    executionMode: scenario.executionMode,
    expectedOutcome: scenario.expected.boardOutcome,
    faultCount: scenario.faults.length,
    tags: [...(scenario.tags ?? [])],
  };
}

/** List stable built-in metadata without exposing mutable catalog objects. */
export function listBoardScenarioMetadata(): BoardScenarioMetadata[] {
  return BUILTIN_SCENARIOS.map(metadataFor);
}

/** Get detached metadata for one built-in scenario. */
export function getBoardScenarioMetadata(id: string): BoardScenarioMetadata | undefined {
  const scenario = SCENARIOS_BY_ID.get(id.trim());
  if (!scenario) return undefined;
  return metadataFor(scenario);
}

/** Get a detached, validated built-in scenario by ID. */
export function getBoardScenario(id: string): BoardScenario | undefined {
  const scenario = SCENARIOS_BY_ID.get(id.trim());
  if (!scenario) return undefined;
  return parseBoardScenario(scenario);
}
