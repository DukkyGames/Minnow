import {
  validateScenarioGraph,
  type BoardScenario,
  type ScenarioFault,
  type ScenarioGraph,
  type ScenarioResponse,
} from './schema.ts';

/** Quick/smoke graphs copied from the deleted V1 test-board seed (engine-free). */
const SCENARIO_PRESET_GRAPHS: Record<'quick' | 'smoke', ScenarioGraph> = {
  quick: {
    waves: [{ id: 'W1' }],
    tasks: [
      { id: 'W1-A', title: 'Greet util', wave: 'W1' },
      { id: 'W1-B', title: 'Add util', wave: 'W1' },
      { id: 'W1-C', title: 'Index barrel', wave: 'W1' },
    ],
  },
  smoke: {
    waves: [{ id: 'W1' }, { id: 'W2' }, { id: 'W3' }],
    tasks: [
      { id: 'W1-A', title: 'Create greet util', wave: 'W1' },
      { id: 'W1-B', title: 'Create add util', wave: 'W1' },
      { id: 'W1-C', title: 'Survey sandbox', wave: 'W1' },
      { id: 'W2-A', title: 'Wire index', wave: 'W2', dependsOn: ['W1-A', 'W1-B'] },
      { id: 'W2-B', title: 'Unit test', wave: 'W2', dependsOn: ['W2-A'] },
      { id: 'W3-A', title: 'Header comment', wave: 'W3', dependsOn: ['W2-A'] },
    ],
  },
};

export interface FakeModelScenarioMatch {
  role?: 'planner' | 'builder' | 'tester' | 'fixer' | 'final' | 'system';
  taskId?: string;
  /** Zero-based occurrence, matching scripts/fake-model-server.mjs. */
  nth?: number;
}

export interface FakeModelScenarioStep {
  match?: FakeModelScenarioMatch;
  /** Preformatted OpenAI-v1 SSE chunks consumed directly by the fake server. */
  emit: string[];
}

export interface FakeModelScenarioPlan {
  scenarioId: string;
  seed: string;
  steps: FakeModelScenarioStep[];
}

export interface ScenarioValidationPlan {
  scenarioId: string;
  seed: string;
  preset: BoardScenario['preset'];
  concurrency: number;
  graph: ScenarioGraph;
  boardLog: {
    tasks: Array<{ id: string; wave: string; dependsOn?: string[] }>;
    waveOrder: string[];
    expectFinalTest: boolean;
    requireTerminal: boolean;
  };
  expected: BoardScenario['expected'];
  recoveries: Array<{
    faultId: string;
    decision: ScenarioFault['expectedRecovery'];
    role: ScenarioFault['target']['role'];
    taskId?: string;
  }>;
}

function proseChunks(text: string): string[] {
  const delta = JSON.stringify({ choices: [{ delta: { content: text } }] });
  const finish = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    'event: end\ndata: {"status":"complete"}\n\n',
  ];
}

function reportOutcomeChunks(taskId: string, toolCallId: string): string[] {
  const args = JSON.stringify({
    outcome: 'pass',
    summary: `Scenario adapter: report_outcome pass for ${taskId}`,
    evidence: [],
    blockers: [],
    needs: [],
  });
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: 'function',
              function: { name: 'report_outcome', arguments: args },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    'event: end\ndata: {"status":"complete"}\n\n',
  ];
}

function responseChunks(
  response: ScenarioResponse,
  taskId: string | undefined,
  message: string | undefined,
): string[] {
  if (response === 'builder_report_missing') {
    return proseChunks(message ?? 'Implementation complete.\n\nStatus: READY FOR VERIFICATION');
  }
  if (response === 'tester_verdict_fail') {
    return proseChunks(message ?? 'VERDICT: fail');
  }
  if (response === 'tester_verdict_pass') {
    return proseChunks(message ?? 'VERDICT: pass');
  }
  if (response === 'builder_report_pass') {
    if (!taskId) {
      throw new Error('builder_report_pass requires a fault target taskId');
    }
    return reportOutcomeChunks(taskId, `call_scenario_${safeId(taskId)}_pass`);
  }
  if (response === 'final_report_pass') {
    return reportOutcomeChunks('FULL_BOARD', 'call_scenario_final_pass');
  }
  if (response === 'generation_error') {
    const payload = JSON.stringify({
      status: 'error',
      errorMessage: message ?? 'Scenario-injected generation error',
    });
    return [`event: end\ndata: ${payload}\n\n`];
  }
  return proseChunks(message ?? 'Scenario-injected tool error');
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '_');
}

function graphForScenario(scenario: BoardScenario): ScenarioGraph {
  if (scenario.preset === 'generated') {
    return validateScenarioGraph(scenario.graph, 'scenario.graph');
  }
  const preset = SCENARIO_PRESET_GRAPHS[scenario.preset === 'smoke' ? 'smoke' : 'quick'];
  return validateScenarioGraph({
    waves: preset.waves,
    tasks: preset.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      wave: task.wave,
      ...(task.dependsOn?.length ? { dependsOn: task.dependsOn } : {}),
    })),
  });
}

function faultStep(fault: ScenarioFault): FakeModelScenarioStep {
  if (fault.action.kind === 'delay') {
    throw new Error(
      `Fake-model match/emit adapter cannot represent delay fault "${fault.id}"`,
    );
  }
  if (
    fault.boundary !== 'report_contract' &&
    fault.boundary !== 'generation_request' &&
    fault.boundary !== 'generation_stream' &&
    fault.boundary !== 'tool_execution'
  ) {
    throw new Error(
      `Fake-model match/emit adapter cannot represent ${fault.boundary} fault "${fault.id}"`,
    );
  }
  return {
    match: {
      role: fault.target.role,
      ...(fault.target.taskId ? { taskId: fault.target.taskId } : {}),
      ...(fault.repeat ? {} : { nth: fault.trigger.occurrence - 1 }),
    },
    emit: responseChunks(
      fault.action.response,
      fault.target.taskId,
      fault.action.message,
    ),
  };
}

function matchKey(match: FakeModelScenarioMatch | undefined): string {
  return `${match?.role ?? '*'}:${match?.taskId ?? '*'}:${match?.nth ?? '*'}`;
}

function baselineSteps(graph: ScenarioGraph): FakeModelScenarioStep[] {
  const steps: FakeModelScenarioStep[] = [];
  for (const task of graph.tasks) {
    steps.push(
      {
        match: { role: 'builder', taskId: task.id, nth: 0 },
        emit: reportOutcomeChunks(task.id, `call_build_${safeId(task.id)}`),
      },
      {
        match: { role: 'builder', taskId: task.id, nth: 1 },
        emit: proseChunks('Done.'),
      },
      {
        match: { role: 'tester', taskId: task.id, nth: 0 },
        emit: proseChunks('VERDICT: pass'),
      },
    );
  }
  steps.push(
    {
      match: { role: 'final', nth: 0 },
      emit: reportOutcomeChunks('FULL_BOARD', 'call_fake_final_report'),
    },
    {
      match: { role: 'final', nth: 1 },
      emit: proseChunks('Done.'),
    },
  );
  return steps;
}

function recoverySteps(scenario: BoardScenario): FakeModelScenarioStep[] {
  const steps: FakeModelScenarioStep[] = [];
  for (const fault of scenario.faults) {
    const taskId = fault.target.taskId;
    if (!taskId || fault.repeat) continue;
    if (
      fault.action.kind === 'respond' &&
      fault.action.response === 'builder_report_missing'
    ) {
      const reportNth = fault.trigger.occurrence;
      steps.push(
        {
          match: { role: 'builder', taskId, nth: reportNth },
          emit: reportOutcomeChunks(taskId, `call_build_nudge_${safeId(taskId)}`),
        },
        {
          match: { role: 'builder', taskId, nth: reportNth + 1 },
          emit: proseChunks('Done.'),
        },
      );
    }
    if (
      fault.action.kind === 'respond' &&
      fault.action.response === 'tester_verdict_fail'
    ) {
      steps.push(
        {
          match: { role: 'builder', taskId, nth: 2 },
          emit: reportOutcomeChunks(taskId, `call_build_retry_${safeId(taskId)}`),
        },
        {
          match: { role: 'builder', taskId, nth: 3 },
          emit: proseChunks('Done.'),
        },
        {
          match: { role: 'tester', taskId, nth: 1 },
          emit: proseChunks('VERDICT: pass'),
        },
      );
    }
  }
  return steps;
}

/**
 * Translate a semantic scenario into the fake model server's ordered first-match steps.
 */
export function toFakeModelScenario(scenario: BoardScenario): FakeModelScenarioPlan {
  const graph = graphForScenario(scenario);
  const faults = scenario.faults.map(faultStep);
  const occupied = new Set(faults.map((step) => matchKey(step.match)));
  const generated = [...recoverySteps(scenario), ...baselineSteps(graph)].filter((step) => {
    const key = matchKey(step.match);
    if (occupied.has(key)) return false;
    occupied.add(key);
    return true;
  });
  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    steps: [...faults, ...generated],
  };
}

/** Derive invariant-check inputs and expected recovery decisions from one scenario. */
export function toScenarioValidationPlan(scenario: BoardScenario): ScenarioValidationPlan {
  const graph = graphForScenario(scenario);
  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    preset: scenario.preset,
    concurrency: scenario.concurrency,
    graph,
    boardLog: {
      tasks: graph.tasks.map((task) => ({
        id: task.id,
        wave: task.wave,
        ...(task.dependsOn?.length ? { dependsOn: [...task.dependsOn] } : {}),
      })),
      waveOrder: graph.waves.map((wave) => wave.id),
      expectFinalTest: scenario.expected.boardOutcome === 'passed',
      requireTerminal: true,
    },
    expected: {
      ...scenario.expected,
      ...(scenario.expected.taskStatuses
        ? { taskStatuses: { ...scenario.expected.taskStatuses } }
        : {}),
      ...(scenario.expected.maxRetries
        ? { maxRetries: { ...scenario.expected.maxRetries } }
        : {}),
    },
    recoveries: scenario.faults.map((fault) => ({
      faultId: fault.id,
      decision: fault.expectedRecovery,
      role: fault.target.role,
      ...(fault.target.taskId ? { taskId: fault.target.taskId } : {}),
    })),
  };
}
