/**
 * Pure mutators for folder-owned Orchestrate boards ({@link ChatGroup.orchestrateBoard}).
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
  ChatGroup,
  OrchestrateBoardState,
} from '../types.ts';
import { getBoardGroupForChat } from './chat-groups.ts';
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
  group: ChatGroup,
  plannerChat: Chat,
  ctx: OrchestrateBoardTimerContext,
): void {
  const board = group.orchestrateBoard;
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
  touchChat(plannerChat);
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

/** Collapse idle waves when opening board view; keep waves with in-progress tasks expanded. */
export function applyOpenBoardWaveCollapse(group: ChatGroup): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  let changed = false;
  for (const wave of board.waves) {
    const hasInProgress = board.tasks.some(
      (t) => String(t.wave) === String(wave.id) && t.status === 'in_progress',
    );
    const nextCollapsed = !hasInProgress;
    if (wave.collapsed === nextCollapsed) continue;
    wave.collapsed = nextCollapsed;
    changed = true;
  }
  if (!changed) return;
  board.lastUpdatedAt = boardNowMs();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Progress percent 0–100 (complete tasks / all tasks). */
export function getBoardProgressPercent(board: OrchestrateBoardState): number {
  if (!board.tasks.length) return 0;
  const completeCount = board.tasks.filter((t) => t.status === 'complete').length;
  return Math.round((completeCount / board.tasks.length) * 100);
}

export function getBoardState(group: ChatGroup): OrchestrateBoardState | null {
  return group.orchestrateBoard ?? null;
}

/** Board on the planner chat's linked folder (if any). */
export function getBoardStateForPlanner(plannerChat: Chat): OrchestrateBoardState | null {
  const group = getBoardGroupForChat(plannerChat);
  return group?.orchestrateBoard ?? null;
}

export function findTaskByRunId(group: ChatGroup, runId: string): BoardTask | null {
  const board = group.orchestrateBoard;
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
    build?: string;
    test?: string;
    agentType?: string;
  }>;
  waves: Array<{ id: number | string }>;
};

/** Create or replace orchestrate board on a folder. */
export function initBoard(
  group: ChatGroup,
  plannerChat: Chat,
  input: InitBoardInput,
): OrchestrateBoardState {
  const now = boardNowMs();
  const tasks: BoardTask[] = input.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    wave: t.wave,
    category: t.category,
    status: 'planned' as BoardTaskStatus,
    ...(t.build?.trim() ? { buildSpec: t.build.trim() } : {}),
    ...(t.test?.trim() ? { testSpec: t.test.trim() } : {}),
    ...(t.agentType?.trim() ? { agentType: t.agentType.trim() } : {}),
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
    maxConcurrentTasks: 3,
  };
  recomputeWaveRollup(board);
  group.orchestrateBoard = board;
  group.orchestratePlanPath = input.planPath;
  group.plannerChatId = plannerChat.id;
  plannerChat.boardGroupId = group.id;
  touchChat(plannerChat);
  scheduleSaveSessions();
  emitBoardChange(group.id);
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
    | 'agentType'
    | 'chatId'
    | 'buildSpec'
    | 'testSpec'
  >
>;

function touchBoardGroup(group: ChatGroup, plannerChat?: Chat): void {
  if (plannerChat) touchChat(plannerChat);
  scheduleSaveSessions();
}

/** Append a sub-agent run id to a task's history (deduped, newest last). */
export function appendTaskRunHistory(
  group: ChatGroup,
  taskId: string,
  runId: string,
  plannerChat?: Chat,
): BoardTask {
  const board = group.orchestrateBoard;
  if (!board) throw new Error('Error: orchestrate board is not initialized');
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Error: unknown board task "${taskId}"`);
  const trimmed = runId.trim();
  if (!trimmed) return task;
  const prev = task.runHistory ?? [];
  const runHistory = prev.includes(trimmed) ? prev : [...prev, trimmed];
  return updateTask(group, taskId, { runHistory }, plannerChat);
}

/** Merge task patch, rollup waves, persist, emit. */
export function updateTask(
  group: ChatGroup,
  taskId: string,
  patch: UpdateTaskPatch,
  plannerChat?: Chat,
): BoardTask {
  const board = group.orchestrateBoard;
  if (!board) throw new Error('Error: orchestrate board is not initialized');
  const idx = board.tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new Error(`Error: unknown board task "${taskId}"`);

  const task: BoardTask = { ...board.tasks[idx], ...patch };
  // Explicit `error: undefined` removes a stale failure message from the task row.
  if ('error' in patch && patch.error === undefined) {
    delete task.error;
  }
  board.tasks[idx] = task;
  board.lastUpdatedAt = boardNowMs();
  recomputeWaveRollup(board);
  touchBoardGroup(group, plannerChat);
  emitBoardChange(group.id);
  return task;
}
