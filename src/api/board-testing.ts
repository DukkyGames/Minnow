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
  mode?: 'manual' | 'auto' | 'sequential';
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

const BASE = '/api/orchestrate/board-testing';

async function postJson<T>(pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : `Request failed (${res.status})`,
    );
  }
  return payload;
}

/** Aggregate fake model, provider, and seeded board status. */
export async function fetchBoardTestingStatus(): Promise<BoardTestingStatus> {
  const res = await fetch(`${BASE}/status`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Status unavailable (${res.status})`);
  }
  return (await res.json()) as BoardTestingStatus;
}

/** Start the in-process fake model server and register the provider. */
export async function startFakeModel(port?: number): Promise<FakeModelStatus> {
  const payload = await postJson<{ fakeModel: FakeModelStatus }>('/fake-model/start', {
    ...(port != null ? { port } : {}),
  });
  return payload.fakeModel;
}

/** Stop the in-process fake model server. */
export async function stopFakeModel(): Promise<FakeModelStatus> {
  const payload = await postJson<{ fakeModel: FakeModelStatus }>('/fake-model/stop');
  return payload.fakeModel;
}

/** Seed a pre-initialized test board into ~/.minnow sessions. */
export async function seedTestBoard(body: SeedBoardRequest): Promise<SeedBoardResponse> {
  return postJson<SeedBoardResponse>('/seed', body);
}

/** Validate a board diagnostic JSONL log against structural invariants. */
export async function checkBoardLog(body: {
  groupId: string;
  plan?: unknown;
}): Promise<CheckBoardLogResponse> {
  return postJson<CheckBoardLogResponse>('/check-log', body);
}
