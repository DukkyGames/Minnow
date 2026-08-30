/**
 * Controller run persistence — registry mirrors and write-ahead result commits (MIN-140 Phase 3).
 */

import { isServerStorageMode } from '../../config/storage-mode';
import type { AggregateResult, RunLifecycle, SubAgentRun, SubAgentStatus } from '../types';
import type { BoardCategory } from '../../types';

/** Persisted registry row mirrored to ~/.minnow/runs/registry/<runId>.json */
export interface PersistedRunRecord {
  runId: string;
  boardTaskId: string | null;
  lifecycle: RunLifecycle;
  attempt: number;
  idempotencyKey: string | null;
  committedResultRef: string | null;
  lastHeartbeatAt: number | null;
  lastProgressAt: number | null;
  progressSeq: number;
  status: SubAgentStatus;
  type: string;
  task: string;
  parentChatId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string;
  error: string | null;
  category?: BoardCategory;
}

const TERMINAL_LIFECYCLES = new Set<RunLifecycle>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

/** Test hook: override API origin (defaults to relative /api/config/runs). */
let runsApiBase = '';

/** Coalesced registry mirror queue (last-write-wins per runId). */
const pendingMirrors = new Map<string, SubAgentRun>();
let mirrorFlushScheduled = false;

/** Throttled persistence failure warnings (once per kind per session). */
const persistenceWarnedAt = new Set<string>();

/** Whether persistence is enabled (server mode + optional test override). */
export function isRunPersistenceEnabled(): boolean {
  return runsApiBase !== '' || isServerStorageMode();
}

/** @internal Test hook for absolute API base URL. */
export function setRunsPersistenceApiBase(base: string): void {
  runsApiBase = base.replace(/\/$/, '');
}

/** @internal Reset mirror coalesce state (tests). */
export function resetMirrorCoalesceForTests(): void {
  pendingMirrors.clear();
  mirrorFlushScheduled = false;
  persistenceWarnedAt.clear();
}

function runsUrl(path: string): string {
  return `${runsApiBase}${path}`;
}

function warnPersistenceOnce(kind: string, detail: string): void {
  if (persistenceWarnedAt.has(kind)) return;
  persistenceWarnedAt.add(kind);
  console.warn(`[controller:persistence] ${kind}: ${detail}`);
}

/** Build stable result key for (boardTaskId, attempt). */
export function resultCommitKey(boardTaskId: string, attempt: number): string {
  const safeTask = boardTaskId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeTask}__${attempt}`;
}

/** Map live run row to a persisted registry record. */
export function toPersistedRunRecord(run: SubAgentRun): PersistedRunRecord {
  return {
    runId: run.runId,
    boardTaskId: run.boardTaskId ?? null,
    lifecycle: run.lifecycle ?? (run.status === 'queued' ? 'queued' : 'running'),
    attempt: run.attempt ?? 1,
    idempotencyKey: run.idempotencyKey ?? null,
    committedResultRef: run.committedResultRef ?? null,
    lastHeartbeatAt: run.lastHeartbeatAt ?? null,
    lastProgressAt: run.lastProgressAt ?? null,
    progressSeq: run.progressSeq ?? 0,
    status: run.status,
    type: run.type,
    task: run.task,
    parentChatId: run.parentChatId ?? null,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    summary: run.summary,
    error: run.error,
    ...(run.category ? { category: run.category } : {}),
  };
}

/** True when lifecycle is terminal and does not need startup reconciliation. */
export function isTerminalPersistedLifecycle(lifecycle: RunLifecycle): boolean {
  return TERMINAL_LIFECYCLES.has(lifecycle);
}

/** Non-mutating runs eligible for one startup re-dispatch (mirrors watchdog tier-1). */
export function isNonMutatingPersistedRecord(record: PersistedRunRecord): boolean {
  const cat = record.category;
  const type = record.type;
  if (cat === 'build' || cat === 'fix') return false;
  if (type === 'shell') return false;
  if (cat === 'research' || cat === 'test') return true;
  if (type === 'explore' || type === 'researcher' || type === 'plan-reviewer' || type === 'pr-reviewer') return true;
  return false;
}

async function runsFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (!isRunPersistenceEnabled()) return null;
  try {
    return await fetch(runsUrl(path), {
      cache: 'no-store',
      ...init,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnPersistenceOnce('fetch_failed', message);
    return null;
  }
}

/** Load all persisted registry entries. */
export async function loadRegistry(): Promise<PersistedRunRecord[]> {
  const res = await runsFetch('/api/config/runs/registry');
  if (!res) return [];
  if (!res.ok) {
    warnPersistenceOnce('registry_list_failed', `HTTP ${res.status}`);
    return [];
  }
  const data = (await res.json()) as { records?: PersistedRunRecord[] };
  return Array.isArray(data.records) ? data.records : [];
}

/** Load a single persisted registry row (for wait/status fallback after eviction). */
export async function loadPersistedRunRecord(
  runId: string,
): Promise<PersistedRunRecord | null> {
  const res = await runsFetch(`/api/config/runs/registry/${encodeURIComponent(runId)}`);
  if (!res) return null;
  if (res.status === 404) return null;
  if (!res.ok) {
    warnPersistenceOnce('registry_get_failed', `HTTP ${res.status} for ${runId}`);
    return null;
  }
  return (await res.json()) as PersistedRunRecord;
}

/** Mirror a registry entry on lifecycle transitions. */
export async function persistRegistryEntry(run: SubAgentRun): Promise<void> {
  const record = toPersistedRunRecord(run);
  const res = await runsFetch(
    `/api/config/runs/registry/${encodeURIComponent(run.runId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    },
  );
  if (!res) return;
  if (!res.ok) {
    warnPersistenceOnce('registry_put_failed', `HTTP ${res.status} for ${run.runId}`);
  }
}

function flushMirrorCoalesce(): void {
  mirrorFlushScheduled = false;
  const batch = [...pendingMirrors.values()];
  pendingMirrors.clear();
  for (const run of batch) {
    void persistRegistryEntry(run);
  }
}

/** Coalesced fire-and-forget registry mirror (last-write-wins per runId). */
export function mirrorRegistryEntry(run: SubAgentRun): void {
  pendingMirrors.set(run.runId, run);
  if (mirrorFlushScheduled) return;
  mirrorFlushScheduled = true;
  queueMicrotask(flushMirrorCoalesce);
}

/** @internal Count pending coalesced mirrors (tests). */
export function pendingMirrorCountForTests(): number {
  return pendingMirrors.size;
}

/** @internal Force flush coalesced mirrors (tests). */
export function flushMirrorsForTests(): void {
  if (mirrorFlushScheduled || pendingMirrors.size > 0) {
    flushMirrorCoalesce();
  }
}

/** Write-ahead commit of aggregate result before completion is signaled. */
export async function commitRunResult(
  run: SubAgentRun,
  result: AggregateResult,
): Promise<string | null> {
  if (!run.boardTaskId) return null;
  const key = resultCommitKey(run.boardTaskId, run.attempt ?? 1);
  const res = await runsFetch(`/api/config/runs/results/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
  if (!res) return null;
  if (!res.ok) {
    warnPersistenceOnce('result_put_failed', `HTTP ${res.status} for ${key}`);
    return null;
  }
  return key;
}

/** Read a previously committed result by ref key. */
export async function readCommittedResult(
  ref: string,
): Promise<AggregateResult | null> {
  const res = await runsFetch(`/api/config/runs/results/${encodeURIComponent(ref)}`);
  if (!res) return null;
  if (res.status === 404) return null;
  if (!res.ok) {
    warnPersistenceOnce('result_get_failed', `HTTP ${res.status} for ${ref}`);
    return null;
  }
  return (await res.json()) as AggregateResult;
}

/** Mark older attempts for the same board task as superseded. */
export async function supersedeOlderAttempts(
  boardTaskId: string,
  attempt: number,
): Promise<void> {
  if (attempt <= 1) return;

  const res = await runsFetch('/api/config/runs/supersede', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boardTaskId, attempt }),
  });
  if (res?.ok) return;

  if (res && !res.ok) {
    warnPersistenceOnce('supersede_failed', `HTTP ${res.status} for ${boardTaskId}`);
  }

  const records = await loadRegistry();
  const now = new Date().toISOString();
  for (const record of records) {
    if (record.boardTaskId !== boardTaskId) continue;
    if ((record.attempt ?? 1) >= attempt) continue;
    if (isTerminalPersistedLifecycle(record.lifecycle)) continue;
    await persistRegistryEntry({
      runId: record.runId,
      type: record.type,
      task: record.task,
      status: 'failed',
      lifecycle: 'interrupted',
      parentChatId: record.parentChatId,
      parentToolCallId: null,
      parentTurnId: null,
      summary: record.summary,
      error: 'superseded',
      startedAt: record.startedAt,
      endedAt: now,
      toolTurns: 0,
      cancelled: false,
      messages: [],
      boardTaskId: record.boardTaskId,
      attempt: record.attempt,
      idempotencyKey: record.idempotencyKey,
      committedResultRef: record.committedResultRef,
      category: record.category,
    });
  }
}

export interface ReconcileHandlers {
  finalizeCompleted: (record: PersistedRunRecord, result: AggregateResult) => Promise<void>;
  reconcileInterrupted: (record: PersistedRunRecord) => Promise<void>;
}

/**
 * Startup reconciliation for non-terminal persisted runs.
 * Committed result present → completed; absent → interrupted + tier policy.
 */
export async function reconcilePersistedRegistry(
  handlers: ReconcileHandlers,
): Promise<void> {
  const records = await loadRegistry();
  for (const record of records) {
    if (isTerminalPersistedLifecycle(record.lifecycle)) continue;

    const ref = record.committedResultRef?.trim();
    if (ref) {
      const result = await readCommittedResult(ref);
      if (result) {
        await handlers.finalizeCompleted(record, result);
        continue;
      }
    }

    await handlers.reconcileInterrupted(record);
  }
}
