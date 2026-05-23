/**
 * Pure mutators for chat.orchestrateBoard (Kanban state).
 *
 * Wave rollup per wave.id from tasks where task.wave === wave.id:
 * - complete: every task is complete
 * - in_progress: any task is in_progress, testing, failed, or blocked
 * - planned: otherwise
 *
 * Progress %: complete tasks / total tasks (failed/blocked are not complete).
 */

import type {
  BoardTask,
  BoardTaskStatus,
  BoardWave,
  Chat,
  OrchestrateBoardState,
} from '../types.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { scheduleSaveSessions, touchChat } from './sessions.ts';

/** Injectable clock for deterministic tests. */
let boardNowMs = (): number => Date.now();

/** Override timestamp source in tests. */
export function setBoardNowForTests(fn: (() => number) | null): void {
  boardNowMs = fn ?? (() => Date.now());
}

export type OrchestrateBoardTimerContext = {
  isStreaming: boolean;
  activeRunCount: number;
  userStopped: boolean;
};

/** Ensure timer fields exist on boards saved before pause-aware elapsed was added. */
function ensureBoardTimerFields(board: OrchestrateBoardState, nowMs: number): void {
  if (typeof board.timerAccumulatedMs !== 'number') {
    board.timerAccumulatedMs = Math.max(0, nowMs - board.startedAt);
  }
}

/** True while the parent orchestrator streams, sub-agents run, or tasks are in flight. */
export function shouldOrchestrateBoardTimerRun(
  board: OrchestrateBoardState,
  ctx: OrchestrateBoardTimerContext,
): boolean {
  if (ctx.userStopped) return false;
  const total = board.tasks.length;
  const completeCount = board.tasks.filter((t) => t.status === 'complete').length;
  if (total > 0 && completeCount === total) return false;
  if (ctx.isStreaming && board.activeParentTurnId) return true;
  if (ctx.activeRunCount > 0) return true;
  return board.tasks.some(
    (t) => t.status === 'in_progress' || t.status === 'testing',
  );
}

/** Elapsed active orchestration time (open segment + accumulated paused total). */
export function getOrchestrateBoardElapsedMs(
  board: OrchestrateBoardState,
  nowMs = boardNowMs(),
): number {
  ensureBoardTimerFields(board, nowMs);
  let ms = board.timerAccumulatedMs ?? 0;
  if (typeof board.timerSegmentStartedAt === 'number') {
    ms += Math.max(0, nowMs - board.timerSegmentStartedAt);
  }
  return ms;
}

/** Open/close timer segments when orchestration transitions between active and idle. */
export function syncOrchestrateBoardTimer(
  chat: Chat,
  ctx: OrchestrateBoardTimerContext,
): void {
  const board = chat.orchestrateBoard;
  if (!board) return;
  const nowMs = boardNowMs();
  ensureBoardTimerFields(board, nowMs);
  const shouldRun = shouldOrchestrateBoardTimerRun(board, ctx);
  const segmentStart = board.timerSegmentStartedAt;
  let changed = false;

  if (shouldRun && segmentStart == null) {
    board.timerSegmentStartedAt = nowMs;
    changed = true;
  } else if (!shouldRun && typeof segmentStart === 'number') {
    board.timerAccumulatedMs =
      (board.timerAccumulatedMs ?? 0) + Math.max(0, nowMs - segmentStart);
    delete board.timerSegmentStartedAt;
    changed = true;
  }

  if (!changed) return;
  board.lastUpdatedAt = nowMs;
  touchChat(chat);
  scheduleSaveSessions();
}

const ACTIVE_WAVE_STATUSES = new Set<BoardTaskStatus>([
  'in_progress',
  'testing',
  'failed',
  'blocked',
]);

/** Roll up one wave row from tasks assigned to that wave. */
export function rollupWaveStatus(
  tasks: BoardTask[],
  waveId: number | string,
): BoardTaskStatus {
  const waveTasks = tasks.filter((t) => t.wave === waveId);
  if (!waveTasks.length) return 'planned';
  if (waveTasks.every((t) => t.status === 'complete')) return 'complete';
  if (waveTasks.some((t) => ACTIVE_WAVE_STATUSES.has(t.status))) return 'in_progress';
  return 'planned';
}

/** Recompute wave rows (status, taskCount, completeCount). */
export function recomputeWaveRollup(board: OrchestrateBoardState): void {
  for (const wave of board.waves) {
    const waveTasks = board.tasks.filter((t) => t.wave === wave.id);
    wave.taskCount = waveTasks.length;
    wave.completeCount = waveTasks.filter((t) => t.status === 'complete').length;
    wave.status = rollupWaveStatus(board.tasks, wave.id);
  }
}

/** Progress percent 0–100 (complete tasks / all tasks). */
export function getBoardProgressPercent(board: OrchestrateBoardState): number {
  if (!board.tasks.length) return 0;
  const completeCount = board.tasks.filter((t) => t.status === 'complete').length;
  return Math.round((completeCount / board.tasks.length) * 100);
}

export function getBoardState(chat: Chat): OrchestrateBoardState | null {
  return chat.orchestrateBoard ?? null;
}

export function findTaskByRunId(chat: Chat, runId: string): BoardTask | null {
  const board = chat.orchestrateBoard;
  if (!board || !runId) return null;
  return (
    board.tasks.find(
      (t) =>
        t.assignedRunId === runId ||
        t.lastRunId === runId ||
        t.runHistory?.includes(runId),
    ) ?? null
  );
}

export type InitBoardInput = {
  planPath: string;
  tasks: Array<{
    id: string;
    title: string;
    wave: number | string;
    category: BoardTask['category'];
  }>;
  waves: Array<{ id: number | string }>;
};

/** Create or replace orchestrate board on chat. */
export function initBoard(chat: Chat, input: InitBoardInput): OrchestrateBoardState {
  const now = boardNowMs();
  const tasks: BoardTask[] = input.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    wave: t.wave,
    category: t.category,
    status: 'planned' as BoardTaskStatus,
  }));
  const waves: BoardWave[] = input.waves.map((w) => ({
    id: w.id,
    status: 'planned' as BoardWave['status'],
  }));
  const board: OrchestrateBoardState = {
    planPath: input.planPath,
    tasks,
    waves,
    startedAt: now,
    lastUpdatedAt: now,
    timerAccumulatedMs: 0,
  };
  recomputeWaveRollup(board);
  chat.orchestrateBoard = board;
  touchChat(chat);
  scheduleSaveSessions();
  emitBoardChange(chat.id);
  return board;
}

export type UpdateTaskPatch = Partial<
  Pick<
    BoardTask,
    | 'status'
    | 'assignedRunId'
    | 'lastRunId'
    | 'runHistory'
    | 'startedAt'
    | 'endedAt'
    | 'filesChanged'
    | 'notes'
    | 'error'
    | 'retryCount'
  >
>;

/** Append a sub-agent run id to a task's history (deduped, newest last). */
export function appendTaskRunHistory(
  chat: Chat,
  taskId: string,
  runId: string,
): BoardTask {
  const board = chat.orchestrateBoard;
  if (!board) throw new Error('Error: orchestrate board is not initialized');
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Error: unknown board task "${taskId}"`);
  const trimmed = runId.trim();
  if (!trimmed) return task;
  const prev = task.runHistory ?? [];
  const runHistory = prev.includes(trimmed) ? prev : [...prev, trimmed];
  return updateTask(chat, taskId, { runHistory });
}

/** Merge task patch, rollup waves, persist, emit. */
export function updateTask(
  chat: Chat,
  taskId: string,
  patch: UpdateTaskPatch,
): BoardTask {
  const board = chat.orchestrateBoard;
  if (!board) throw new Error('Error: orchestrate board is not initialized');
  const idx = board.tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new Error(`Error: unknown board task "${taskId}"`);

  const task = { ...board.tasks[idx], ...patch };
  board.tasks[idx] = task;
  board.lastUpdatedAt = boardNowMs();
  recomputeWaveRollup(board);
  touchChat(chat);
  scheduleSaveSessions();
  emitBoardChange(chat.id);
  return task;
}
