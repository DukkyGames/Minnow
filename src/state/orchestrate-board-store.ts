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

import { syncOrchestratorPlannerChatTitle } from '../chat/orchestrate/planner-chat-title.ts';
import type {
  BoardTask,
  BoardTaskStatus,
  BoardWave,
  Chat,
  ChatGroup,
  OrchestrateBoardState,
} from '../types.ts';
import { getBoardGroupForChat, getPlannerChatForGroup, linkPlannerChatToBoardFolder } from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { scheduleSaveSessions, sessionState, touchChat } from './sessions.ts';

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

/** Whether all tasks in waves before `taskWave` are complete. */
export function isPriorWavesComplete(
  board: OrchestrateBoardState,
  taskWave: number | string,
): boolean {
  const waveIndex = board.waves.findIndex((w) => String(w.id) === String(taskWave));
  if (waveIndex <= 0) return true;
  for (let i = 0; i < waveIndex; i += 1) {
    const priorWaveId = board.waves[i]!.id;
    const priorTasks = board.tasks.filter(
      (t) => String(t.wave) === String(priorWaveId),
    );
    if (!priorTasks.length) continue;
    if (!priorTasks.every((t) => t.status === 'complete')) return false;
  }
  return true;
}

/** True when all explicit dependsOn tasks are complete (or when the task has none). */
export function isDepsComplete(
  board: OrchestrateBoardState,
  task: BoardTask,
): boolean {
  if (isTaskInDependencyCycle(board, task.id)) return false;
  if (!task.dependsOn?.length) return true;
  for (const depId of task.dependsOn) {
    if (depId === task.id) continue; // skip self-edges
    const dep = board.tasks.find((t) => t.id === depId);
    if (!dep) continue; // unknown ids: don't hard-block
    if (dep.status !== 'complete') return false;
  }
  return true;
}

/**
 * Find dependency cycles via DFS over task.dependsOn edges.
 * Returns one closed path per detected cycle (last node repeats the first).
 */
export function detectDependencyCycles(board: OrchestrateBoardState): string[][] {
  const taskIds = new Set(board.tasks.map((t) => t.id));
  const adj = new Map<string, string[]>();
  for (const task of board.tasks) {
    adj.set(
      task.id,
      (task.dependsOn ?? []).filter((depId) => depId !== task.id && taskIds.has(depId)),
    );
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    visiting.add(node);
    stack.push(node);
    for (const depId of adj.get(node) ?? []) {
      if (visited.has(depId)) continue;
      if (visiting.has(depId)) {
        const start = stack.indexOf(depId);
        if (start >= 0) {
          cycles.push([...stack.slice(start), node]);
        }
        continue;
      }
      dfs(depId);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const id of taskIds) {
    if (!visited.has(id)) dfs(id);
  }
  return cycles;
}

/** Task ids that participate in at least one dependsOn cycle. */
export function detectCycleTaskIds(board: OrchestrateBoardState): Set<string> {
  const ids = new Set<string>();
  for (const cycle of detectDependencyCycles(board)) {
    for (const id of cycle) ids.add(id);
  }
  return ids;
}

function isTaskInDependencyCycle(
  board: OrchestrateBoardState,
  taskId: string,
): boolean {
  return detectCycleTaskIds(board).has(taskId);
}

function formatDependencyCycleError(cycle: string[]): string {
  if (cycle.length < 2) return 'dependency cycle detected';
  const path = cycle.join(' → ');
  return `dependency cycle: ${path}`;
}

/** Planned task whose prior waves are complete (simple wave ordering). */
export function isTaskReadyForAuto(
  board: OrchestrateBoardState,
  task: BoardTask,
): boolean {
  if (task.status !== 'planned') return false;
  if (isTaskInDependencyCycle(board, task.id)) return false;
  if (!isDepsComplete(board, task)) return false;
  return isPriorWavesComplete(board, task.wave);
}

/**
 * Task marked in_progress/testing but its chat is not starting or streaming (stuck slot).
 * Used by auto-pilot to retry delegation.
 */
export function isTaskStalledForRestart(
  board: OrchestrateBoardState,
  task: BoardTask,
  isChatActive: (chatId: string) => boolean,
): boolean {
  if (task.status !== 'in_progress' && task.status !== 'testing') return false;
  const chatId =
    task.status === 'testing'
      ? task.testChatId?.trim() || task.chatId?.trim()
      : task.chatId?.trim();
  if (!chatId) return true;
  return !isChatActive(chatId);
}

/** Move a board task to in_progress when its linked chat actually begins streaming. */
export function markBoardTaskInProgressFromChat(chat: Chat): void {
  const taskId = chat.boardTaskId?.trim();
  if (!taskId) return;
  // Tester / final-integration chats must not pull the card back to in_progress.
  if (chat.workAgentId === 'tester') return;
  const boardGroup =
    getBoardGroupForChat(chat) ??
    (chat.boardGroupId
      ? sessionState?.groups?.find((g) => g.id === chat.boardGroupId)
      : undefined);
  if (!boardGroup?.orchestrateBoard) return;
  const existing = boardGroup.orchestrateBoard.tasks.find((t) => t.id === taskId);
  if (!existing || existing.status === 'complete' || existing.status === 'testing') return;
  const planner = getPlannerChatForGroup(boardGroup);
  const patch: Parameters<typeof updateTask>[2] = {
    status: 'in_progress',
    startedAt: existing.startedAt ?? boardNowMs(),
  };
  if (existing.error) patch.error = undefined;
  updateTask(boardGroup, taskId, patch, planner ?? undefined);
}

/** Resolved execution mode (defaults to manual). */
export function getBoardExecutionMode(
  board: OrchestrateBoardState | null | undefined,
): 'manual' | 'auto' | 'sequential' {
  const m = board?.executionMode;
  if (m === 'auto' || m === 'sequential') return m;
  return 'manual';
}

/** True when the board is in auto-pilot delegation mode (auto or sequential). */
export function isBoardAutoMode(group: ChatGroup): boolean {
  const mode = getBoardExecutionMode(group.orchestrateBoard);
  return mode === 'auto' || mode === 'sequential';
}

/** True when auto/sequential mode is active AND the user has pressed Start. */
export function isBoardRunning(group: ChatGroup): boolean {
  return isBoardAutoMode(group) && group.orchestrateBoard?.autoRunning === true;
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

/** Tasks that left the planned column (in flight, testing, or settled). */
export function countBoardTasksProgressed(board: OrchestrateBoardState): number {
  return board.tasks.filter((t) => t.status !== 'planned').length;
}

/** Waves with rollup past planned (at least one started or finished task). */
export function countBoardWavesProgressed(board: OrchestrateBoardState): number {
  return board.waves.filter((w) => w.status !== 'planned').length;
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
    dependsOn?: string[];
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
    ...(t.dependsOn && t.dependsOn.length ? { dependsOn: [...t.dependsOn] } : {}),
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
    executionMode: 'manual',
  };
  const cycles = detectDependencyCycles(board);
  if (cycles.length > 0) {
    const cycleTaskIds = detectCycleTaskIds(board);
    for (const task of tasks) {
      if (!cycleTaskIds.has(task.id)) continue;
      const cycle = cycles.find((c) => c.includes(task.id));
      task.status = 'blocked';
      task.error = cycle ? formatDependencyCycleError(cycle) : 'dependency cycle detected';
    }
  }
  recomputeWaveRollup(board);
  group.orchestrateBoard = board;
  group.orchestratePlanPath = input.planPath;
  linkPlannerChatToBoardFolder(plannerChat, group);
  syncOrchestratorPlannerChatTitle(plannerChat, input.planPath);
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
    | 'chatId'
    | 'buildSpec'
    | 'testSpec'
    | 'testChatId'
    | 'testAttempts'
    | 'testVerdict'
    | 'testSummary'
    | 'pendingBuildSeed'
    | 'worktreePath'
    | 'worktreeBranch'
    | 'devPort'
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
