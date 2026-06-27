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
import { getAutopilotMetaSync } from '../config/autopilot-meta.ts';
import { reportBackgroundError } from '../boot/report-background-error.ts';
import type {
  BoardLogDetail,
  BoardLogEvent,
  BoardLogLevel,
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

export const BOARD_LOG_MAX = 100;
const BOARD_LOG_PREVIEW_MAX = 200;

let boardLogSeq = 0;

/** Optional disk sink, set at boot (server/Electron); undefined in unit tests. */
let boardLogDiskSink: ((groupId: string, e: BoardLogEvent) => void) | undefined;

/** Wire JSONL mirror sink at app boot; omit in tests. */
export function setBoardLogDiskSink(fn?: typeof boardLogDiskSink): void {
  boardLogDiskSink = fn;
}

/** Reset log sequence counter between tests. */
export function resetBoardLogForTests(): void {
  boardLogSeq = 0;
}

/** Set the next log sequence counter (tests with pre-seeded log ids). */
export function setBoardLogSeqForTests(n: number): void {
  boardLogSeq = n;
}

function truncateBoardLogPreview(value: string, max = BOARD_LOG_PREVIEW_MAX): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/** Append one board log row, cap the ring buffer, persist, and notify listeners. */
export function appendBoardLog(
  group: ChatGroup,
  event: Omit<BoardLogEvent, 'id' | 'ts'> & { ts?: number },
): BoardLogEvent | null {
  const board = group.orchestrateBoard;
  if (!board) return null;
  const ts = event.ts ?? boardNowMs();
  const full: BoardLogEvent = { ...event, ts, id: `${ts}-${boardLogSeq++}` };
  const log = board.log ?? (board.log = []);
  log.push(full);
  if (log.length > BOARD_LOG_MAX) log.splice(0, log.length - BOARD_LOG_MAX);
  try {
    boardLogDiskSink?.(group.id, full);
  } catch (err) {
    reportBackgroundError('board-log-disk', err);
  }
  scheduleSaveSessions();
  emitBoardChange(group.id);
  return full;
}

export function logTaskStatus(
  group: ChatGroup,
  taskId: string,
  from: BoardTaskStatus | undefined,
  to: BoardTaskStatus,
): void {
  if (from === to) return;
  const level: BoardLogLevel = to === 'failed' || to === 'blocked' ? 'error' : 'info';
  appendBoardLog(group, {
    type: 'task_status',
    level,
    taskId,
    message: `${taskId}: ${from ?? '?'} → ${to}`,
    detail: { from, to },
  });
}

export function logBoardInit(
  group: ChatGroup,
  taskCount: number,
  waveCount: number,
): void {
  appendBoardLog(group, {
    type: 'board_init',
    level: 'info',
    message: `Board initialized (${taskCount} tasks, ${waveCount} waves)`,
    detail: { summary: `${taskCount} tasks, ${waveCount} waves` },
  });
}

export function logTaskError(
  group: ChatGroup,
  taskId: string,
  error: string,
): void {
  appendBoardLog(group, {
    type: 'task_error',
    level: 'error',
    taskId,
    message: `${taskId}: ${truncateBoardLogPreview(error, 200)}`,
    detail: { error: truncateBoardLogPreview(error) },
  });
}

export function logTaskStarted(
  group: ChatGroup,
  taskId: string,
  chatId: string,
): void {
  appendBoardLog(group, {
    type: 'task_started',
    level: 'info',
    taskId,
    message: `${taskId}: build chat started`,
    detail: { chatId },
  });
}

export function logModeChange(
  group: ChatGroup,
  mode: 'manual' | 'auto' | 'sequential' | 'afk',
): void {
  appendBoardLog(group, {
    type: 'mode_change',
    level: 'info',
    message: `Execution mode → ${mode}`,
    detail: { mode },
  });
}

export function logAutoStart(group: ChatGroup): void {
  appendBoardLog(group, {
    type: 'auto_start',
    level: 'info',
    message: 'Auto execution started',
  });
}

export function logAutoStop(group: ChatGroup): void {
  appendBoardLog(group, {
    type: 'auto_stop',
    level: 'info',
    message: 'Auto execution stopped by user',
  });
}

export function logBuildVerdict(
  group: ChatGroup,
  taskId: string,
  verdict: 'pass' | 'fail' | 'stopped',
  detail?: BoardLogDetail,
): void {
  if (verdict === 'stopped') {
    appendBoardLog(group, {
      type: 'build_verdict',
      level: 'info',
      taskId,
      message: `${taskId}: build stopped`,
      detail,
    });
    return;
  }
  const level: BoardLogLevel = verdict === 'pass' ? 'info' : detail?.attempt ? 'warn' : 'error';
  appendBoardLog(group, {
    type: 'build_verdict',
    level,
    taskId,
    message: `${taskId}: build ${verdict}`,
    detail: { verdict, ...detail },
  });
}

export function logTestVerdict(
  group: ChatGroup,
  taskId: string,
  verdict: 'pass' | 'fail',
  summary?: string,
  attempt?: number,
): void {
  appendBoardLog(group, {
    type: 'test_verdict',
    level: verdict === 'pass' ? 'info' : attempt ? 'warn' : 'error',
    taskId,
    message: `${taskId}: test ${verdict}${summary ? ` — ${truncateBoardLogPreview(summary, 120)}` : ''}`,
    detail: { verdict, summary: summary ? truncateBoardLogPreview(summary) : undefined, attempt },
  });
}

export function logMergeResult(
  group: ChatGroup,
  taskId: string,
  outcome: NonNullable<BoardLogDetail['outcome']>,
  detail?: BoardLogDetail,
): void {
  const level: BoardLogLevel =
    outcome === 'merged' || outcome === 'skipped' ? 'info' : 'error';
  appendBoardLog(group, {
    type: 'merge_result',
    level,
    taskId,
    message: `${taskId}: merge ${outcome}`,
    detail: { outcome, ...detail },
  });
}

export function logWorktreeAllocated(
  group: ChatGroup,
  taskId: string,
  branch: string,
  devPort: number,
  apiPort: number,
): void {
  appendBoardLog(group, {
    type: 'worktree_allocated',
    level: 'info',
    taskId,
    message: `${taskId}: worktree ${branch} (dev ${devPort}, api ${apiPort})`,
    detail: { branch, devPort, apiPort },
  });
}

export function logTaskRetry(
  group: ChatGroup,
  taskId: string,
  attemptKind: 'build' | 'test' | 'fixer',
  attempt: number,
): void {
  appendBoardLog(group, {
    type: 'task_retry',
    level: 'warn',
    taskId,
    message: `${taskId}: ${attemptKind} retry #${attempt}`,
    detail: { attemptKind, attempt },
  });
}

export function logFinalTestStarted(group: ChatGroup, chatId: string): void {
  appendBoardLog(group, {
    type: 'final_test_started',
    level: 'info',
    message: 'Final integration test started',
    detail: { chatId },
  });
}

export function logFinalTestVerdict(
  group: ChatGroup,
  verdict: 'pass' | 'fail',
  summary?: string,
  failingTaskIds?: string[],
): void {
  appendBoardLog(group, {
    type: 'final_test_verdict',
    level: verdict === 'pass' ? 'info' : 'error',
    message: `Final integration test ${verdict}`,
    detail: {
      verdict,
      summary: summary ? truncateBoardLogPreview(summary) : undefined,
      failingTaskIds,
    },
  });
}

export function logBoardToolCall(
  group: ChatGroup,
  taskId: string,
  toolName: string,
  argsPreview: string,
  resultPreview: string,
  errored: boolean,
  chatId: string,
): void {
  appendBoardLog(group, {
    type: 'tool_call',
    level: errored ? 'error' : 'info',
    taskId,
    message: `${taskId}: ${toolName}`,
    detail: {
      toolName,
      argsPreview: truncateBoardLogPreview(argsPreview),
      resultPreview: truncateBoardLogPreview(resultPreview),
      chatId,
    },
  });
}

export function logBoardTerminalRun(
  group: ChatGroup,
  taskId: string,
  command: string,
  exitCode: number | undefined,
  resultPreview: string,
  errored: boolean,
  chatId: string,
): void {
  appendBoardLog(group, {
    type: 'terminal_run',
    level: errored || (exitCode != null && exitCode !== 0) ? 'error' : 'info',
    taskId,
    message: `${taskId}: ${truncateBoardLogPreview(command, 120)}`,
    detail: {
      command: truncateBoardLogPreview(command),
      exitCode,
      resultPreview: truncateBoardLogPreview(resultPreview),
      chatId,
    },
  });
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
    (t) => t.status === 'in_progress' || t.status === 'testing' || t.status === 'merging',
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
  'merging',
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
  // All terminal (complete or quarantined) — treat as complete for wave gating.
  if (waveTasks.every((t) => t.status === 'complete' || t.status === 'quarantined')) return 'complete';
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
    // Quarantined counts as settled — a quarantined prior wave must not stall later waves.
    if (!priorTasks.every((t) => t.status === 'complete' || t.status === 'quarantined')) return false;
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

/**
 * Quarantine a task and all of its transitive dependents (BFS over reverse dep edges).
 * Independent siblings are left untouched.
 */
export function quarantineTaskAndDependents(
  group: ChatGroup,
  taskId: string,
  issue: BoardTask['quarantine'],
  plannerChat?: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board || !issue) return;

  // Build reverse adjacency: task id → ids whose dependsOn includes it.
  const taskIds = new Set(board.tasks.map((t) => t.id));
  const reverseAdj = new Map<string, string[]>();
  for (const task of board.tasks) {
    for (const depId of task.dependsOn ?? []) {
      if (depId === task.id || !taskIds.has(depId)) continue;
      const list = reverseAdj.get(depId) ?? [];
      list.push(task.id);
      reverseAdj.set(depId, list);
    }
  }

  // BFS from the root task, quarantining each node.
  const visited = new Set<string>();
  const queue: string[] = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const isRoot = current === taskId;
    const payload: BoardTask['quarantine'] = isRoot
      ? issue
      : { category: 'stall', summary: `blocked by quarantined ${taskId}`, resolutionSteps: [], at: issue.at };

    updateTask(group, current, { status: 'quarantined', quarantine: payload }, plannerChat);

    for (const dependentId of reverseAdj.get(current) ?? []) {
      if (!visited.has(dependentId)) queue.push(dependentId);
    }
  }
}

function formatDependencyCycleError(cycle: string[]): string {
  if (cycle.length < 2) return 'dependency cycle detected';
  const path = cycle.join(' → ');
  return `dependency cycle: ${path}`;
}

/** Planned task whose deps and wave barrier are both satisfied. */
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
  // An active fixer (env-fixer runs under in_progress) owns the task — the
  // builder/tester chat is intentionally idle, so this is not a stuck slot.
  const fixerId = task.fixerChatId?.trim();
  if (fixerId && isChatActive(fixerId)) return false;
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
  if (!existing || existing.status === 'complete' || existing.status === 'testing' || existing.status === 'merging') return;
  if (existing.fixerChatId === chat.id) return;
  const planner = getPlannerChatForGroup(boardGroup);
  const patch: Parameters<typeof updateTask>[2] = {
    status: 'in_progress',
    startedAt: existing.startedAt ?? boardNowMs(),
  };
  if (existing.error) patch.error = undefined;
  updateTask(boardGroup, taskId, patch, planner ?? undefined);
  if (existing.status !== 'in_progress') {
    logTaskStarted(boardGroup, taskId, chat.id);
  }
}

/** Resolved execution mode (defaults to manual). */
export function getBoardExecutionMode(
  board: OrchestrateBoardState | null | undefined,
): 'manual' | 'auto' | 'sequential' | 'afk' {
  const m = board?.executionMode;
  if (m === 'auto' || m === 'sequential' || m === 'afk') return m;
  return 'manual';
}

/** True when the board is in auto-pilot delegation mode (auto, sequential, or afk). */
export function isBoardAutoMode(group: ChatGroup): boolean {
  const mode = getBoardExecutionMode(group.orchestrateBoard);
  return mode === 'auto' || mode === 'sequential' || mode === 'afk';
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
    maxConcurrentTasks: getAutopilotMetaSync().maxConcurrentTasks ?? 3,
    executionMode: getAutopilotMetaSync().defaultExecutionMode ?? 'manual',
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
  logBoardInit(group, tasks.length, waves.length);
  if (cycles.length > 0) {
    for (const task of tasks) {
      if (task.status === 'blocked' && task.error) {
        logTaskError(group, task.id, task.error);
      }
    }
  }
  scheduleSaveSessions();
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
    | 'fixerChatId'
    | 'fixerKind'
    | 'envFixAttempts'
    | 'envFixPhase'
    | 'testAttempts'
    | 'buildAttempts'
    | 'fixerAttempts'
    | 'stopRetries'
    | 'mergePreSha'
    | 'testVerdict'
    | 'testSummary'
    | 'boardReport'
    | 'buildBlockers'
    | 'prevFailure'
    | 'pendingBuildSeed'
    | 'worktreePath'
    | 'worktreeBranch'
    | 'devPort'
    | 'apiPort'
    | 'quarantine'
    | 'selfHealRound'
    | 'lastHealCategory'
    | 'buildOutcome'
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
  if ('testVerdict' in patch && patch.testVerdict === undefined) {
    delete task.testVerdict;
  }
  if ('testSummary' in patch && patch.testSummary === undefined) {
    delete task.testSummary;
  }
  if ('boardReport' in patch && patch.boardReport === undefined) {
    delete task.boardReport;
  }
  if ('buildOutcome' in patch && patch.buildOutcome === undefined) {
    delete task.buildOutcome;
  }
  if ('buildBlockers' in patch && patch.buildBlockers === undefined) {
    delete task.buildBlockers;
  }
  if ('testAttempts' in patch && patch.testAttempts === undefined) {
    delete task.testAttempts;
  }
  if ('buildAttempts' in patch && patch.buildAttempts === undefined) {
    delete task.buildAttempts;
  }
  if ('fixerChatId' in patch && patch.fixerChatId === undefined) {
    delete task.fixerChatId;
  }
  if ('fixerKind' in patch && patch.fixerKind === undefined) {
    delete task.fixerKind;
  }
  if ('envFixPhase' in patch && patch.envFixPhase === undefined) {
    delete task.envFixPhase;
  }
  if ('mergePreSha' in patch && patch.mergePreSha === undefined) {
    delete task.mergePreSha;
  }
  if ('fixerAttempts' in patch && patch.fixerAttempts === undefined) {
    delete task.fixerAttempts;
  }
  if ('stopRetries' in patch && patch.stopRetries === undefined) {
    delete task.stopRetries;
  }
  if ('quarantine' in patch && patch.quarantine === undefined) {
    delete task.quarantine;
  }
  board.tasks[idx] = task;
  board.lastUpdatedAt = boardNowMs();
  recomputeWaveRollup(board);
  touchBoardGroup(group, plannerChat);
  emitBoardChange(group.id);
  return task;
}
