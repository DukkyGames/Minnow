/**
 * Production-neutral scenario schema for deterministic Orchestrate reliability runs.
 */

export const SCENARIO_PRESETS = ['quick', 'smoke', 'generated'] as const;
export const SCENARIO_EXECUTION_MODES = ['afk', 'auto', 'sequential'] as const;
export const SCENARIO_BOUNDARIES = [
  'generation_request',
  'generation_stream',
  'tool_execution',
  'report_contract',
  'task_launch',
  'timer_heartbeat',
  'session_save_load',
  'worktree_create',
  'task_commit',
  'integration_merge',
  'integration_verify',
  'planner_report',
  'notification',
  'process_restart',
] as const;
export const SCENARIO_ROLES = ['planner', 'builder', 'tester', 'fixer', 'final', 'system'] as const;
export const SCENARIO_PHASES = [
  'planning',
  'build',
  'test',
  'fix',
  'merge',
  'verify',
  'final',
  'complete',
] as const;
export const SCENARIO_RESPONSES = [
  'builder_report_pass',
  'builder_report_missing',
  'tester_verdict_pass',
  'tester_verdict_fail',
  'final_report_pass',
  'generation_error',
  'tool_error',
] as const;
export const SCENARIO_RECOVERY_DECISIONS = [
  'continue',
  'nudge',
  'retry_build',
  'retry_test',
  'run_fixer',
  'quarantine',
  'block_board',
  'restart_and_resume',
] as const;
export const SCENARIO_CHECKPOINTS = [
  'after_board_start',
  'after_launch_reservation',
  'during_builder_generation',
  'after_mutation_before_report',
  'after_report_before_finalize',
  'between_build_and_test',
  'during_tester_generation',
  'after_test_before_merge',
  'during_merge',
  'during_fixer',
  'after_merge_before_persist',
  'during_final_integration',
  'after_terminal_before_notification',
] as const;

export type ScenarioPreset = (typeof SCENARIO_PRESETS)[number];
export type ScenarioExecutionMode = (typeof SCENARIO_EXECUTION_MODES)[number];
export type ScenarioBoundary = (typeof SCENARIO_BOUNDARIES)[number];
export type ScenarioRole = (typeof SCENARIO_ROLES)[number];
export type ScenarioPhase = (typeof SCENARIO_PHASES)[number];
export type ScenarioResponse = (typeof SCENARIO_RESPONSES)[number];
export type ScenarioRecoveryDecision = (typeof SCENARIO_RECOVERY_DECISIONS)[number];
export type ScenarioCheckpoint = (typeof SCENARIO_CHECKPOINTS)[number];

export interface ScenarioTask {
  id: string;
  title: string;
  wave: string;
  dependsOn?: string[];
}

export interface ScenarioGraph {
  tasks: ScenarioTask[];
  waves: Array<{ id: string }>;
}

export type ScenarioFaultAction =
  | { kind: 'respond'; response: ScenarioResponse; message?: string }
  | { kind: 'delay'; delayMs: number };

export interface ScenarioFault {
  id: string;
  boundary: ScenarioBoundary;
  target: {
    role: ScenarioRole;
    phase: ScenarioPhase;
    taskId?: string;
  };
  trigger: {
    kind: 'occurrence';
    /** One-based occurrence at the semantic boundary. */
    occurrence: number;
  };
  action: ScenarioFaultAction;
  repeat: boolean;
  expectedRecovery: ScenarioRecoveryDecision;
}

export interface ScenarioExpectedOutcome {
  boardOutcome: 'passed' | 'blocked';
  taskStatuses?: Record<string, string>;
  maxRetries?: Record<string, number>;
}

export interface BoardScenario {
  id: string;
  family: string;
  description: string;
  preset: ScenarioPreset;
  executionMode: ScenarioExecutionMode;
  seed: string;
  expected: ScenarioExpectedOutcome;
  faults: ScenarioFault[];
  restartCheckpoints?: ScenarioCheckpoint[];
  graph?: ScenarioGraph;
  tags?: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function fail(path: string, message: string): never {
  throw new Error(`Invalid board scenario at ${path}: ${message}`);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function assertKeys(row: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(row)) {
    if (!allowedSet.has(key)) {
      fail(`${path}.${key}`, 'unknown field');
    }
  }
}

function stringAt(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(path, 'expected a non-empty string');
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail(path, 'has an invalid format');
  }
  return normalized;
}

function enumAt<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `expected one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function positiveIntegerAt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(path, 'expected a positive integer');
  }
  return Number(value);
}

function stringArrayAt(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    fail(path, 'expected an array');
  }
  return value.map((entry, index) => stringAt(entry, `${path}[${index}]`));
}

export function validateScenarioGraph(value: unknown, path = 'graph'): ScenarioGraph {
  const row = recordAt(value, path);
  assertKeys(row, ['tasks', 'waves'], path);
  if (!Array.isArray(row.tasks) || !Array.isArray(row.waves)) {
    fail(path, 'tasks and waves must be arrays');
  }

  const waves = row.waves.map((entry, index) => {
    const wave = recordAt(entry, `${path}.waves[${index}]`);
    assertKeys(wave, ['id'], `${path}.waves[${index}]`);
    return { id: stringAt(wave.id, `${path}.waves[${index}].id`, TASK_ID_PATTERN) };
  });
  const waveIds = new Set<string>();
  for (const wave of waves) {
    if (waveIds.has(wave.id)) {
      fail(`${path}.waves`, `duplicate wave id "${wave.id}"`);
    }
    waveIds.add(wave.id);
  }

  const tasks = row.tasks.map((entry, index) => {
    const taskPath = `${path}.tasks[${index}]`;
    const task = recordAt(entry, taskPath);
    assertKeys(task, ['id', 'title', 'wave', 'dependsOn'], taskPath);
    const dependsOn =
      task.dependsOn === undefined ? undefined : stringArrayAt(task.dependsOn, `${taskPath}.dependsOn`);
    return {
      id: stringAt(task.id, `${taskPath}.id`, TASK_ID_PATTERN),
      title: stringAt(task.title, `${taskPath}.title`),
      wave: stringAt(task.wave, `${taskPath}.wave`, TASK_ID_PATTERN),
      ...(dependsOn?.length ? { dependsOn } : {}),
    };
  });
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      fail(`${path}.tasks`, `duplicate task id "${task.id}"`);
    }
    taskIds.add(task.id);
    if (!waveIds.has(task.wave)) {
      fail(`${path}.tasks`, `task "${task.id}" references unknown wave "${task.wave}"`);
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!taskIds.has(dependency)) {
        fail(`${path}.tasks`, `task "${task.id}" references unknown dependency "${dependency}"`);
      }
      if (dependency === task.id) {
        fail(`${path}.tasks`, `task "${task.id}" cannot depend on itself`);
      }
    }
  }

  return { tasks, waves };
}

function parseFault(value: unknown, path: string): ScenarioFault {
  const row = recordAt(value, path);
  assertKeys(
    row,
    ['id', 'boundary', 'target', 'trigger', 'action', 'repeat', 'expectedRecovery'],
    path,
  );
  const target = recordAt(row.target, `${path}.target`);
  assertKeys(target, ['role', 'phase', 'taskId'], `${path}.target`);
  const trigger = recordAt(row.trigger, `${path}.trigger`);
  assertKeys(trigger, ['kind', 'occurrence'], `${path}.trigger`);
  if (trigger.kind !== 'occurrence') {
    fail(`${path}.trigger.kind`, 'expected "occurrence"');
  }
  const action = recordAt(row.action, `${path}.action`);
  const actionKind = enumAt(action.kind, ['respond', 'delay'] as const, `${path}.action.kind`);
  let parsedAction: ScenarioFaultAction;
  if (actionKind === 'respond') {
    assertKeys(action, ['kind', 'response', 'message'], `${path}.action`);
    parsedAction = {
      kind: 'respond',
      response: enumAt(action.response, SCENARIO_RESPONSES, `${path}.action.response`),
      ...(action.message === undefined
        ? {}
        : { message: stringAt(action.message, `${path}.action.message`) }),
    };
  } else {
    assertKeys(action, ['kind', 'delayMs'], `${path}.action`);
    parsedAction = {
      kind: 'delay',
      delayMs: positiveIntegerAt(action.delayMs, `${path}.action.delayMs`),
    };
  }
  if (typeof row.repeat !== 'boolean') {
    fail(`${path}.repeat`, 'expected a boolean');
  }
  const boundary = enumAt(row.boundary, SCENARIO_BOUNDARIES, `${path}.boundary`);
  const role = enumAt(target.role, SCENARIO_ROLES, `${path}.target.role`);
  if (parsedAction.kind === 'respond') {
    const response = parsedAction.response;
    const reportResponse =
      response === 'builder_report_pass' ||
      response === 'builder_report_missing' ||
      response === 'tester_verdict_pass' ||
      response === 'tester_verdict_fail' ||
      response === 'final_report_pass';
    if (reportResponse && boundary !== 'report_contract') {
      fail(`${path}.action.response`, 'report responses require the report_contract boundary');
    }
    if (response.startsWith('builder_') && role !== 'builder') {
      fail(`${path}.action.response`, 'builder responses require the builder role');
    }
    if (response.startsWith('tester_') && role !== 'tester') {
      fail(`${path}.action.response`, 'tester responses require the tester role');
    }
    if (response === 'final_report_pass' && role !== 'final') {
      fail(`${path}.action.response`, 'final reports require the final role');
    }
    if (
      response === 'generation_error' &&
      boundary !== 'generation_request' &&
      boundary !== 'generation_stream'
    ) {
      fail(
        `${path}.action.response`,
        'generation_error requires a generation_request or generation_stream boundary',
      );
    }
    if (response === 'tool_error' && boundary !== 'tool_execution') {
      fail(`${path}.action.response`, 'tool_error requires the tool_execution boundary');
    }
  }

  return {
    id: stringAt(row.id, `${path}.id`, ID_PATTERN),
    boundary,
    target: {
      role,
      phase: enumAt(target.phase, SCENARIO_PHASES, `${path}.target.phase`),
      ...(target.taskId === undefined
        ? {}
        : { taskId: stringAt(target.taskId, `${path}.target.taskId`, TASK_ID_PATTERN) }),
    },
    trigger: {
      kind: 'occurrence',
      occurrence: positiveIntegerAt(trigger.occurrence, `${path}.trigger.occurrence`),
    },
    action: parsedAction,
    repeat: row.repeat,
    expectedRecovery: enumAt(
      row.expectedRecovery,
      SCENARIO_RECOVERY_DECISIONS,
      `${path}.expectedRecovery`,
    ),
  };
}

function parseExpected(value: unknown, path: string): ScenarioExpectedOutcome {
  const row = recordAt(value, path);
  assertKeys(row, ['boardOutcome', 'taskStatuses', 'maxRetries'], path);
  const expected: ScenarioExpectedOutcome = {
    boardOutcome: enumAt(row.boardOutcome, ['passed', 'blocked'] as const, `${path}.boardOutcome`),
  };
  for (const field of ['taskStatuses', 'maxRetries'] as const) {
    if (row[field] === undefined) continue;
    const entries = recordAt(row[field], `${path}.${field}`);
    const parsed: Record<string, string | number> = {};
    for (const [key, entry] of Object.entries(entries)) {
      const taskId = stringAt(key, `${path}.${field} key`, TASK_ID_PATTERN);
      parsed[taskId] =
        field === 'maxRetries'
          ? positiveIntegerAt(entry, `${path}.${field}.${taskId}`)
          : stringAt(entry, `${path}.${field}.${taskId}`);
    }
    Object.assign(expected, { [field]: parsed });
  }
  return expected;
}

/** Parse, normalize, and strictly validate an untrusted scenario value. */
export function parseBoardScenario(value: unknown): BoardScenario {
  const row = recordAt(value, '$');
  assertKeys(
    row,
    [
      'id',
      'family',
      'description',
      'preset',
      'executionMode',
      'seed',
      'expected',
      'faults',
      'restartCheckpoints',
      'graph',
      'tags',
    ],
    '$',
  );
  if (!Array.isArray(row.faults)) {
    fail('$.faults', 'expected an array');
  }
  const preset = enumAt(row.preset, SCENARIO_PRESETS, '$.preset');
  const faults = row.faults.map((fault, index) => parseFault(fault, `$.faults[${index}]`));
  const faultIds = new Set<string>();
  for (const fault of faults) {
    if (faultIds.has(fault.id)) {
      fail('$.faults', `duplicate fault id "${fault.id}"`);
    }
    faultIds.add(fault.id);
  }
  if (preset === 'generated' && row.graph === undefined) {
    fail('$.graph', 'generated scenarios require a graph');
  }
  if (preset !== 'generated' && row.graph !== undefined) {
    fail('$.graph', 'only generated scenarios may define a graph');
  }

  const restartCheckpoints =
    row.restartCheckpoints === undefined
      ? undefined
      : stringArrayAt(row.restartCheckpoints, '$.restartCheckpoints').map((checkpoint, index) =>
          enumAt(checkpoint, SCENARIO_CHECKPOINTS, `$.restartCheckpoints[${index}]`),
        );
  const tags = row.tags === undefined ? undefined : stringArrayAt(row.tags, '$.tags');
  return {
    id: stringAt(row.id, '$.id', ID_PATTERN),
    family: stringAt(row.family, '$.family', ID_PATTERN),
    description: stringAt(row.description, '$.description'),
    preset,
    executionMode: enumAt(row.executionMode, SCENARIO_EXECUTION_MODES, '$.executionMode'),
    seed: stringAt(row.seed, '$.seed'),
    expected: parseExpected(row.expected, '$.expected'),
    faults,
    ...(restartCheckpoints?.length ? { restartCheckpoints } : {}),
    ...(row.graph === undefined ? {} : { graph: validateScenarioGraph(row.graph, '$.graph') }),
    ...(tags?.length ? { tags } : {}),
  };
}

/** Validate a complete catalog and reject duplicate scenario IDs. */
export function validateScenarioCatalog(values: readonly unknown[]): BoardScenario[] {
  const scenarios = values.map(parseBoardScenario);
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) {
      throw new Error(`Duplicate board scenario id "${scenario.id}"`);
    }
    ids.add(scenario.id);
  }
  return scenarios;
}
