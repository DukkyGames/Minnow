/**
 * Turn-run CRUD and branch helpers (pure, no DOM).
 */

import { randomUUID } from '../lib/random-id.ts';
import type {
  Chat,
  ChatStopReason,
  Message,
  TurnRunId,
  TurnRunRecord,
  TurnRunStatus,
  TurnSnapshot,
} from '../types';

function ensureRunsArray(chat: Chat): TurnRunRecord[] {
  if (!chat.runs) {
    chat.runs = [];
  }
  return chat.runs;
}

function newRunId(): TurnRunId {
  return randomUUID();
}

function newBranchId(): string {
  return randomUUID();
}

/** Runs at a fork index, newest first. */
export function listRunsAtFork(chat: Chat, forkHistoryIndex: number): TurnRunRecord[] {
  const runs = chat.runs ?? [];
  return runs
    .filter((r) => r.forkHistoryIndex === forkHistoryIndex)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Pickable branches (completed or stopped with valid output range). */
export function listSelectableBranchesAtFork(
  chat: Chat,
  forkHistoryIndex: number,
): TurnRunRecord[] {
  return listRunsAtFork(chat, forkHistoryIndex).filter((r) => isBranchActivatable(chat, r));
}

export function isBranchActivatable(chat: Chat, run: TurnRunRecord): boolean {
  if (
    run.status !== 'completed' &&
    run.status !== 'stopped' &&
    run.status !== 'superseded'
  ) {
    return false;
  }
  if (run.outputMessages && run.outputMessages.length > 0) {
    return true;
  }
  const start = run.outputHistoryStart;
  const end = run.outputHistoryEnd;
  if (start === undefined || end === undefined) return false;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return false;
  }
  return end < chat.history.length;
}

/** Active run record for a fork (from activeBranchByFork map). */
export function getActiveRun(
  chat: Chat,
  forkHistoryIndex: number,
): TurnRunRecord | undefined {
  const forkKey = String(forkHistoryIndex);
  const branchId = chat.activeBranchByFork?.[forkKey];
  if (!branchId) {
    const runs = listRunsAtFork(chat, forkHistoryIndex);
    return runs.find((r) => r.status === 'completed' || r.status === 'stopped');
  }
  return (chat.runs ?? []).find((r) => r.branchId === branchId);
}

export function setActiveBranch(
  chat: Chat,
  forkHistoryIndex: number,
  branchId: string,
): void {
  if (!chat.activeBranchByFork) {
    chat.activeBranchByFork = {};
  }
  chat.activeBranchByFork[String(forkHistoryIndex)] = branchId;
}

export interface CreateRunOptions {
  parentRunId?: TurnRunId;
  parentTurnId?: string;
  overrides?: Partial<
    Pick<TurnSnapshot, 'providerId' | 'modelId' | 'temperature' | 'maxTokens'>
  >;
}

/** Append a new run; supersede prior non-superseded runs at the same fork. */
export function createRun(
  chat: Chat,
  snapshot: TurnSnapshot,
  options: CreateRunOptions = {},
): TurnRunRecord {
  const runs = ensureRunsArray(chat);
  for (const existing of runs) {
    if (
      existing.forkHistoryIndex === snapshot.forkHistoryIndex &&
      existing.status !== 'superseded'
    ) {
      existing.status = 'superseded';
      if (!existing.endedAt) {
        existing.endedAt = Date.now();
      }
    }
  }

  const merged: TurnSnapshot = {
    ...snapshot,
    ...(options.overrides?.providerId !== undefined
      ? { providerId: options.overrides.providerId }
      : {}),
    ...(options.overrides?.modelId !== undefined
      ? { modelId: options.overrides.modelId }
      : {}),
    ...(options.overrides?.temperature !== undefined
      ? { temperature: options.overrides.temperature }
      : {}),
    ...(options.overrides?.maxTokens !== undefined
      ? { maxTokens: options.overrides.maxTokens }
      : {}),
  };

  const record: TurnRunRecord = {
    runId: newRunId(),
    branchId: newBranchId(),
    forkHistoryIndex: merged.forkHistoryIndex,
    parentRunId: options.parentRunId,
    parentTurnId: options.parentTurnId,
    status: 'running',
    createdAt: Date.now(),
    snapshot: merged,
    generationIds: [],
  };
  runs.push(record);
  setActiveBranch(chat, merged.forkHistoryIndex, record.branchId);
  return record;
}

export function findRunById(chat: Chat, runId: TurnRunId): TurnRunRecord | undefined {
  return (chat.runs ?? []).find((r) => r.runId === runId);
}

export function noteRunGeneration(chat: Chat, runId: TurnRunId, generationId: string): void {
  const run = findRunById(chat, runId);
  if (!run) return;
  if (!run.generationIds) {
    run.generationIds = [];
  }
  if (!run.generationIds.includes(generationId)) {
    run.generationIds.push(generationId);
  }
}

export function noteRunOutputIndex(chat: Chat, runId: TurnRunId, historyIndex: number): void {
  const run = findRunById(chat, runId);
  if (!run) return;
  if (run.outputHistoryStart === undefined) {
    run.outputHistoryStart = historyIndex;
  }
  run.outputHistoryEnd = historyIndex;
}

export interface FinalizeRunOptions {
  status: TurnRunStatus;
  outputHistoryStart?: number;
  outputHistoryEnd?: number;
  outputMessages?: Message[];
  endedAt?: number;
  stopReason?: ChatStopReason;
}

export function finalizeRun(
  chat: Chat,
  runId: TurnRunId,
  options: FinalizeRunOptions,
): void {
  const run = findRunById(chat, runId);
  if (!run || run.status === 'superseded') return;
  run.status = options.status;
  run.endedAt = options.endedAt ?? Date.now();
  if (options.outputHistoryStart !== undefined) {
    run.outputHistoryStart = options.outputHistoryStart;
  }
  if (options.outputHistoryEnd !== undefined) {
    run.outputHistoryEnd = options.outputHistoryEnd;
  }
  if (options.outputMessages?.length) {
    run.outputMessages = options.outputMessages.map((m) => ({ ...m }));
  }
  if (run.status === 'stopped' && options.stopReason) {
    run.stopReason = options.stopReason;
  }
  if (run.status === 'completed' || run.status === 'stopped') {
    setActiveBranch(chat, run.forkHistoryIndex, run.branchId);
  }
}

/**
 * After truncate at cutIndex (inclusive user row kept):
 * mark runs whose outputs extended past the cut as superseded.
 */
export function pruneSupersededRunsAfterTruncate(chat: Chat, cutIndex: number): void {
  const runs = chat.runs ?? [];
  for (const run of runs) {
    const outStart = run.outputHistoryStart;
    if (outStart !== undefined && outStart > cutIndex) {
      run.status = 'superseded';
      delete run.outputMessages;
      if (!run.endedAt) {
        run.endedAt = Date.now();
      }
    }
    if (run.forkHistoryIndex > cutIndex) {
      run.status = 'superseded';
      if (!run.endedAt) {
        run.endedAt = Date.now();
      }
    }
  }

  if (!chat.activeBranchByFork) return;
  const next: Record<string, string> = {};
  for (const [forkKey, branchId] of Object.entries(chat.activeBranchByFork)) {
    const fork = Number(forkKey);
    if (!Number.isFinite(fork) || fork > cutIndex) continue;
    const run = runs.find((r) => r.branchId === branchId);
    if (run && isBranchActivatable(chat, run)) {
      next[forkKey] = branchId;
    }
  }
  chat.activeBranchByFork = next;
}

/**
 * Rebuild chat.history from shared prefix through fork + selected branch output.
 */
export function activateBranch(
  chat: Chat,
  forkHistoryIndex: number,
  branchId: string,
): boolean {
  const run = (chat.runs ?? []).find((r) => r.branchId === branchId);
  if (!run || !isBranchActivatable(chat, run)) {
    return false;
  }

  const prefixEnd = forkHistoryIndex;
  if (prefixEnd < 0 || prefixEnd >= chat.history.length) {
    return false;
  }
  const userRow = chat.history[prefixEnd];
  if (!userRow || userRow.role !== 'user') {
    return false;
  }

  let suffix: Message[];
  if (run.outputMessages?.length) {
    suffix = run.outputMessages.map((m) => ({ ...m }));
  } else {
    const start = run.outputHistoryStart!;
    const end = run.outputHistoryEnd!;
    suffix = chat.history.slice(start, end + 1);
  }
  if (suffix.length === 0) {
    return false;
  }

  chat.history = [...chat.history.slice(0, prefixEnd + 1), ...suffix];
  setActiveBranch(chat, forkHistoryIndex, branchId);
  return true;
}
