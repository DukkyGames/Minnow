/**
 * Client helpers for Settings → Advanced → Board testing API.
 */

export type FakeModelStatus = {
  running: boolean;
  port: number | null;
  baseUrl: string | null;
  requestCount: number;
  modelId: string;
  providerId: string;
  scenarioStepCount?: number;
};

export type FakeModelScenarioMatch = {
  role?: string;
  taskId?: string;
  nth?: number;
};

export type FakeModelScenarioStep = {
  match?: FakeModelScenarioMatch;
  emit: string[];
};

export type FakeModelScenarioConfiguration = {
  stepCount: number;
  steps: FakeModelScenarioStep[];
};

export type SanitizedFakeModelRequest = {
  at?: number;
  method?: string;
  url?: string;
  context?: {
    role?: string;
    taskId?: string;
    nth?: number;
  };
  body?: unknown;
};

export type BoardLogTailResponse = {
  ok: true;
  groupId: string;
  events: unknown[];
  malformedLines: number;
  truncated: boolean;
};

export type BoardTestingStatus = {
  ok?: boolean;
  fakeModel: FakeModelStatus;
  providerRegistered: boolean;
  seededBoard: {
    count: number;
    present: boolean;
    stableTestBoardPresent?: boolean;
    groupId: string | null;
    plannerId: string | null;
    workspacePath: string | null;
    taskCount: number | null;
  };
};

export type SeedBoardRequest = {
  workspacePath?: string;
  preset?: 'quick' | 'smoke';
  mode?: 'manual' | 'afk' | 'auto' | 'sequential';
  autoStart?: boolean;
  providerId?: string;
  modelId?: string;
  /** Reuse canonical test ids (for CI fixtures). Default: fresh ids per seed. */
  stableIds?: boolean;
};

export type SeedBoardResponse = {
  ok: boolean;
  groupId?: string;
  plannerId?: string;
  workspacePath?: string;
  taskCount?: number;
  error?: string;
};

export type BoardLogViolation = {
  id: string;
  taskId?: string;
  eventId?: string;
  message: string;
};

export type CheckBoardLogResponse = {
  ok: boolean;
  logPath?: string;
  eventsCount?: number;
  skippedInvariants?: string[];
  violations?: BoardLogViolation[];
  error?: string;
};

export type BoardScenarioCatalogEntry = {
  id: string;
  family: string;
  description: string;
  preset: 'quick' | 'smoke' | 'generated';
  executionMode: 'afk' | 'auto' | 'sequential';
  expectedOutcome: 'passed' | 'blocked';
  faultCount: number;
  tags: string[];
  scenario?: Record<string, unknown>;
};

export type BoardScenarioRunClassification =
  | 'pass'
  | 'expected_blocked'
  | 'unexpected_blocked'
  | 'product_failure'
  | 'timeout'
  | 'harness_error'
  | 'stopped';

export type BoardScenarioRunStatus =
  | 'prepared'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'stopped';

export type BoardScenarioRunArtifact = {
  name: string;
  path: string;
  mediaType?: string;
  href?: string;
};

export type BoardScenarioRun = {
  id: string;
  status: BoardScenarioRunStatus;
  classification: BoardScenarioRunClassification | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  currentIteration?: number | null;
  phase?: string | null;
  requestCount?: number;
  artifactDirectory?: string;
  config: {
    scenarioId: string;
    iterations: number;
    timeoutMs: number;
    seed: number;
    failFast: boolean;
    execution?: 'internal' | 'external';
  };
  summary: {
    completed: number;
    passed: number;
    failed: number;
  };
  artifacts: BoardScenarioRunArtifact[];
  replayOf?: {
    runId: string;
    iteration: number;
    seed: number;
  } | null;
};

export type BoardScenarioIterationResult = {
  iteration: number;
  seed: number | null;
  classification: BoardScenarioRunClassification;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number | null;
  error?: string;
  [key: string]: unknown;
};

export type BoardScenarioResults = {
  runId: string;
  status: BoardScenarioRunStatus;
  classification: BoardScenarioRunClassification | null;
  iterations: BoardScenarioIterationResult[];
};

export type PrepareBoardScenarioRunRequest = {
  scenario: Record<string, unknown>;
  iterations: number;
  timeoutMs: number;
  seed: number;
  failFast: boolean;
  execution?: 'internal' | 'external';
};

export type SubmitBoardScenarioIterationRequest = {
  iteration: number;
  seed: number;
  classification: Exclude<BoardScenarioRunClassification, 'stopped'>;
  error?: string;
  boardLog?: unknown[];
  fakeModelRequests?: SanitizedFakeModelRequest[];
  finalState?: unknown;
  violations?: BoardLogViolation[];
};

const BASE = '/api/orchestrate/board-testing';

async function requestJson<T>(
  pathname: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    cache: 'no-store',
    ...options,
  });
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : `Request failed (${res.status})`,
    );
  }
  return payload;
}

async function postJson<T>(
  pathname: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return requestJson<T>(pathname, {
    method: 'POST',
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });
}

/** Aggregate fake model, provider, and seeded board status. */
export async function fetchBoardTestingStatus(
  signal?: AbortSignal,
): Promise<BoardTestingStatus> {
  return requestJson<BoardTestingStatus>('/status', { signal });
}

/** Start the in-process fake model server and register the provider. */
export async function startFakeModel(
  port?: number,
  signal?: AbortSignal,
): Promise<FakeModelStatus> {
  const payload = await postJson<{ fakeModel: FakeModelStatus }>('/fake-model/start', {
    ...(port != null ? { port } : {}),
  }, signal);
  return payload.fakeModel;
}

/** Stop the in-process fake model server. */
export async function stopFakeModel(): Promise<FakeModelStatus> {
  const payload = await postJson<{ fakeModel: FakeModelStatus }>('/fake-model/stop');
  return payload.fakeModel;
}

/** Seed a pre-initialized test board into ~/.minnow sessions. */
export async function seedTestBoard(
  body: SeedBoardRequest,
  signal?: AbortSignal,
): Promise<SeedBoardResponse> {
  return postJson<SeedBoardResponse>('/seed', body, signal);
}

/** Validate a board diagnostic JSONL log against structural invariants. */
export async function checkBoardLog(body: {
  groupId: string;
  plan?: unknown;
}, signal?: AbortSignal): Promise<CheckBoardLogResponse> {
  return postJson<CheckBoardLogResponse>('/check-log', body, signal);
}

/** Replace the fake model's ordered match/emit scenario and reset request counters. */
export async function configureFakeModelScenario(
  scenario: { steps: FakeModelScenarioStep[] } | FakeModelScenarioStep[],
  signal?: AbortSignal,
): Promise<FakeModelScenarioConfiguration> {
  const payload = await postJson<{ scenario: FakeModelScenarioConfiguration }>(
    '/fake-model/scenario',
    { scenario },
    signal,
  );
  return payload.scenario;
}

/** Fetch a bounded, server-sanitized tail of fake model requests. */
export async function fetchFakeModelRequestTail(
  limit = 200,
  signal?: AbortSignal,
): Promise<SanitizedFakeModelRequest[]> {
  const payload = await requestJson<{ requests: SanitizedFakeModelRequest[] }>(
    `/fake-model/requests?limit=${encodeURIComponent(String(limit))}`,
    { signal },
  );
  return payload.requests;
}

/** Fetch a bounded, server-sanitized board diagnostic log tail. */
export async function fetchBoardLogTail(
  groupId: string,
  limit = 500,
  signal?: AbortSignal,
): Promise<BoardLogTailResponse> {
  return requestJson<BoardLogTailResponse>(
    `/board-log/tail?groupId=${encodeURIComponent(groupId)}&limit=${encodeURIComponent(String(limit))}`,
    { signal },
  );
}

/** Fetch server-provided scenario metadata when the catalog route is available. */
export async function fetchBoardScenarioCatalog(
  signal?: AbortSignal,
): Promise<BoardScenarioCatalogEntry[]> {
  const payload = await requestJson<
    | BoardScenarioCatalogEntry[]
    | { scenarios: BoardScenarioCatalogEntry[] }
  >('/scenarios', { signal });
  return Array.isArray(payload) ? payload : payload.scenarios;
}

/** Persist a scenario run configuration without starting execution. */
export async function prepareBoardScenarioRun(
  body: PrepareBoardScenarioRunRequest,
  signal?: AbortSignal,
): Promise<BoardScenarioRun> {
  const payload = await postJson<{ run: BoardScenarioRun }>('/runs/prepare', body, signal);
  return payload.run;
}

/** Start a prepared scenario run. */
export async function startBoardScenarioRun(
  runId: string,
  signal?: AbortSignal,
): Promise<BoardScenarioRun> {
  const payload = await postJson<{ run: BoardScenarioRun }>(
    `/runs/${encodeURIComponent(runId)}/start`,
    undefined,
    signal,
  );
  return payload.run;
}

/** Stop a prepared or active scenario run. */
export async function stopBoardScenarioRun(
  runId: string,
  signal?: AbortSignal,
): Promise<BoardScenarioRun> {
  const payload = await postJson<{ run: BoardScenarioRun }>(
    `/runs/${encodeURIComponent(runId)}/stop`,
    undefined,
    signal,
  );
  return payload.run;
}

/** Read the latest persisted and in-memory run status. */
export async function fetchBoardScenarioRunStatus(
  runId: string,
  signal?: AbortSignal,
): Promise<BoardScenarioRun> {
  const payload = await requestJson<{ run: BoardScenarioRun }>(
    `/runs/${encodeURIComponent(runId)}/status`,
    { signal },
  );
  return payload.run;
}

/** Read terminal iteration results for a run. */
export async function fetchBoardScenarioResults(
  runId: string,
  signal?: AbortSignal,
): Promise<BoardScenarioResults> {
  const payload = await requestJson<{ results: BoardScenarioResults }>(
    `/runs/${encodeURIComponent(runId)}/results`,
    { signal },
  );
  return payload.results;
}

/** Prepare a one-iteration replay using the original deterministic seed. */
export async function replayBoardScenarioRun(
  runId: string,
  iteration?: number,
  signal?: AbortSignal,
): Promise<BoardScenarioRun> {
  const payload = await postJson<{ run: BoardScenarioRun }>(
    `/runs/${encodeURIComponent(runId)}/replay`,
    iteration == null ? {} : { iteration },
    signal,
  );
  return payload.run;
}

/** Submit exactly the next deterministic result for a running external renderer run. */
export async function submitBoardScenarioIteration(
  runId: string,
  body: SubmitBoardScenarioIterationRequest,
  signal?: AbortSignal,
): Promise<BoardScenarioRun> {
  const payload = await postJson<{ run: BoardScenarioRun }>(
    `/runs/${encodeURIComponent(runId)}/iterations`,
    body,
    signal,
  );
  return payload.run;
}
