/**
 * Pipeline holds — concurrency slots occupied by a task id during non-streaming
 * pipeline phases (merge, fixer handoff, env-fixer finalize).
 *
 * Keyed by board object identity (stable per session). If the board object is
 * ever swapped, holds vanish — fails open to pre-hold behaviour, never deadlocks.
 */

import type { OrchestrateBoardState } from '../types.ts';

export type PipelineHoldReason =
  | 'merge'
  | 'merge-fixer-start'
  | 'merge-fixer-finalize'
  | 'env-fixer-finalize';

export interface PipelineHold {
  board: OrchestrateBoardState;
  taskId: string;
  id: string;
  reason: PipelineHoldReason;
  acquiredAt: number;
}

export type PipelineHoldLogAction = 'acquire' | 'release' | 'expiry';

export interface PipelineHoldLogContext {
  onEvent?: (
    action: PipelineHoldLogAction,
    hold: PipelineHold,
    activeHoldCount: number,
  ) => void;
}

const PIPELINE_HOLD_MAX_MS = 10 * 60_000;

/** Test override for hold TTL (null restores production cap). */
let pipelineHoldMaxMsOverride: number | null = null;

type HoldEntry = {
  acquiredAt: number;
  reason: PipelineHoldReason;
  logContext?: PipelineHoldLogContext;
};

/** Per-board ref-counted holds: taskId → holdId → entry. */
const holdsByBoard = new WeakMap<
  OrchestrateBoardState,
  Map<string, Map<string, HoldEntry>>
>();

let holdIdSeq = 0;

function resolveHoldMaxMs(): number {
  return pipelineHoldMaxMsOverride ?? PIPELINE_HOLD_MAX_MS;
}

function getBoardHolds(board: OrchestrateBoardState): Map<string, Map<string, HoldEntry>> {
  let map = holdsByBoard.get(board);
  if (!map) {
    map = new Map();
    holdsByBoard.set(board, map);
  }
  return map;
}

function countHoldEntries(board: OrchestrateBoardState): number {
  let count = 0;
  for (const taskHolds of holdsByBoard.get(board)?.values() ?? []) {
    count += taskHolds.size;
  }
  return count;
}

function notifyHoldEvent(
  action: PipelineHoldLogAction,
  board: OrchestrateBoardState,
  taskId: string,
  holdId: string,
  entry: HoldEntry,
): void {
  entry.logContext?.onEvent?.(
    action,
    {
      board,
      taskId,
      id: holdId,
      reason: entry.reason,
      acquiredAt: entry.acquiredAt,
    },
    countHoldEntries(board),
  );
}

/** Drop holds older than TTL; returns task ids that had at least one hold released. */
function pruneExpiredHolds(
  board: OrchestrateBoardState,
  nowMs: number,
): string[] {
  const maxMs = resolveHoldMaxMs();
  const boardHolds = holdsByBoard.get(board);
  if (!boardHolds) return [];
  const released: string[] = [];
  for (const [taskId, holdMap] of boardHolds) {
    for (const [holdId, entry] of holdMap) {
      if (nowMs - entry.acquiredAt > maxMs) {
        holdMap.delete(holdId);
        notifyHoldEvent('expiry', board, taskId, holdId, entry);
        if (!released.includes(taskId)) released.push(taskId);
      }
    }
    if (holdMap.size === 0) boardHolds.delete(taskId);
  }
  if (boardHolds.size === 0) holdsByBoard.delete(board);
  return released;
}

/** Task ids with at least one non-expired hold (TTL-on-read). */
function heldTaskIds(board: OrchestrateBoardState, nowMs = Date.now()): string[] {
  pruneExpiredHolds(board, nowMs);
  const boardHolds = holdsByBoard.get(board);
  if (!boardHolds) return [];
  return [...boardHolds.keys()];
}

/** Acquire a pipeline hold for a task; null when board or taskId is missing. */
export function acquirePipelineHold(
  board: OrchestrateBoardState | undefined | null,
  taskId: string | undefined,
  reason: PipelineHoldReason,
  logContext?: PipelineHoldLogContext,
): PipelineHold | null {
  const id = taskId?.trim();
  if (!board || !id) return null;
  const nowMs = Date.now();
  pruneExpiredHolds(board, nowMs);
  const boardHolds = getBoardHolds(board);
  let taskHolds = boardHolds.get(id);
  if (!taskHolds) {
    taskHolds = new Map();
    boardHolds.set(id, taskHolds);
  }
  const holdId = `ph-${++holdIdSeq}`;
  const acquiredAt = nowMs;
  const entry: HoldEntry = { acquiredAt, reason, logContext };
  taskHolds.set(holdId, entry);
  const hold = { board, taskId: id, id: holdId, reason, acquiredAt };
  notifyHoldEvent('acquire', board, id, holdId, entry);
  return hold;
}

/** Release one hold (idempotent). Does not drain the task queue. */
export function releasePipelineHold(hold: PipelineHold | null | undefined): void {
  if (!hold) return;
  const boardHolds = holdsByBoard.get(hold.board);
  if (!boardHolds) return;
  const taskHolds = boardHolds.get(hold.taskId);
  if (!taskHolds) return;
  const entry = taskHolds.get(hold.id);
  if (!entry) return;
  taskHolds.delete(hold.id);
  notifyHoldEvent('release', hold.board, hold.taskId, hold.id, entry);
  if (taskHolds.size === 0) boardHolds.delete(hold.taskId);
  if (boardHolds.size === 0) holdsByBoard.delete(hold.board);
}

/** Release every hold for a task; returns count released. */
export function releasePipelineHoldsForTask(
  board: OrchestrateBoardState | undefined | null,
  taskId: string | undefined,
): number {
  const id = taskId?.trim();
  if (!board || !id) return 0;
  const boardHolds = holdsByBoard.get(board);
  if (!boardHolds) return 0;
  const taskHolds = boardHolds.get(id);
  if (!taskHolds) return 0;
  const count = taskHolds.size;
  for (const [holdId, entry] of taskHolds) {
    taskHolds.delete(holdId);
    notifyHoldEvent('release', board, id, holdId, entry);
  }
  boardHolds.delete(id);
  if (boardHolds.size === 0) holdsByBoard.delete(board);
  return count;
}

/** Release all holds on a board; returns count released. */
export function releaseAllPipelineHolds(
  board: OrchestrateBoardState | undefined | null,
): number {
  if (!board) return 0;
  const boardHolds = holdsByBoard.get(board);
  if (!boardHolds) return 0;
  let count = 0;
  for (const [taskId, taskHolds] of boardHolds) {
    count += taskHolds.size;
    for (const [holdId, entry] of taskHolds) {
      taskHolds.delete(holdId);
      notifyHoldEvent('release', board, taskId, holdId, entry);
    }
  }
  holdsByBoard.delete(board);
  return count;
}

/** True when the task has a non-expired hold (TTL-on-read). */
export function hasPipelineHold(
  board: OrchestrateBoardState | undefined | null,
  taskId: string | undefined,
  nowMs = Date.now(),
): boolean {
  const id = taskId?.trim();
  if (!board || !id) return false;
  pruneExpiredHolds(board, nowMs);
  const taskHolds = holdsByBoard.get(board)?.get(id);
  return Boolean(taskHolds && taskHolds.size > 0);
}

/** Count distinct tasks with non-expired holds, optionally excluding one task. */
export function countHeldTaskIds(
  board: OrchestrateBoardState | undefined | null,
  excludeTaskId?: string,
  nowMs = Date.now(),
): number {
  if (!board) return 0;
  const exclude = excludeTaskId?.trim();
  let count = 0;
  for (const taskId of heldTaskIds(board, nowMs)) {
    if (exclude && taskId === exclude) continue;
    count += 1;
  }
  return count;
}

/** List active holds for UI / diagnostics (expired holds pruned). */
export function listPipelineHolds(
  board: OrchestrateBoardState | undefined | null,
  nowMs = Date.now(),
): Array<{ taskId: string; reason: PipelineHoldReason; acquiredAt: number }> {
  if (!board) return [];
  pruneExpiredHolds(board, nowMs);
  const boardHolds = holdsByBoard.get(board);
  if (!boardHolds) return [];
  const out: Array<{ taskId: string; reason: PipelineHoldReason; acquiredAt: number }> = [];
  for (const [taskId, holdMap] of boardHolds) {
    for (const entry of holdMap.values()) {
      out.push({ taskId, reason: entry.reason, acquiredAt: entry.acquiredAt });
    }
  }
  return out;
}

/** Active sweep — release expired holds; returns released task ids. */
export function sweepExpiredPipelineHolds(
  board: OrchestrateBoardState | undefined | null,
  nowMs = Date.now(),
): string[] {
  if (!board) return [];
  return pruneExpiredHolds(board, nowMs);
}

/** Test override for hold TTL. */
export function setPipelineHoldMaxMsForTests(ms: number | null): void {
  pipelineHoldMaxMsOverride = ms;
}

/** Internal: iterate held task ids for occupancy dedupe. */
export function heldTaskIdsForOccupancy(
  board: OrchestrateBoardState,
): string[] {
  return heldTaskIds(board);
}
