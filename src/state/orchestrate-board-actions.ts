/**
 * Manual orchestrate board operations — shared by UI buttons and LLM tools.
 */

import { stopGeneration } from '../chat/stop-generation.ts';
import { decodeModelSelectKey } from '../lib/model-select-key.ts';
import { isOrchestratePlanComplete } from '../chat/orchestrate/plan-complete.ts';
import { maybeEmitOrchestratePlanComplete } from '../chat/orchestrate/plan-complete-ui.ts';
import {
  isChatStreaming,
  subscribeChatStreamActivity,
  subscribeChatStreamEnd,
} from '../chat/streaming-state.ts';
import { isChatTurnSetupPending } from '../chat/chat-turn-guard.ts';
import { loadSubAgentConfig } from '../agents/sub-agent-config.ts';
import {
  bindRunSupervision,
  bumpProgress,
  chatTaskRunId,
  createRunSupervision,
  setHeartbeatConfig,
  startHeartbeat,
  stopHeartbeat,
} from '../agents/controller/wrapper.ts';
import { runChatTurn } from '../tools/loop.ts';
import { reportBackgroundError } from '../boot/report-background-error.ts';
import { normalizeVerdict } from '../tools/board-tools.ts';
import { schedulePostTurnSynthesis } from '../synthesis/client.ts';
import { buildSynthesisMessages, buildSynthesisExcerpt } from '../synthesis/post-turn.ts';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup, OrchestrateBoardState, SessionState } from '../types.ts';
import {
  assignChatToGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { isTaskReadyForAuto, isTaskStalledForRestart, isBoardAutoMode, isBoardRunning, getBoardExecutionMode, syncOrchestrateBoardTimer, updateTask } from './orchestrate-board-store.ts';
import {
  isIsolationActive,
  resolveIsolationMode,
  worktreeBranchFor,
  worktreeSlotId,
  boardIntegrationBranch,
  allocateDevPort,
  usedDevPorts,
  DEFAULT_BOARD_PORT_BASE,
} from './worktree-isolation.ts';
import {
  ensureIntegration as ensureIntegrationWorktree,
  createWorktree as createTaskWorktreeOp,
  mergeIntoIntegration as mergeTaskIntoIntegration,
  commitWorktree as commitTaskWorktree,
  checkMerged as checkTaskBranchMerged,
  restoreIntegration as restoreIntegrationWorktree,
  verifyIntegrationMerge as verifyIntegrationMergeOp,
  refreshIntegrationDeps as refreshIntegrationDepsOp,
  cleanupBoardWorktrees as cleanupBoardWorktreesOp,
} from './worktree-service.ts';

const MAX_MERGE_FIXER_ATTEMPTS = 2;

export { getBoardExecutionMode, isBoardAutoMode, isBoardRunning };
import {
  createEmptyChatObject,
  findChatById,
  saveSessionsNow,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from './sessions.ts';

function requireSession(): NonNullable<typeof sessionState> {
  if (!sessionState) throw new Error('Session not loaded');
  return sessionState;
}

const DEFAULT_MAX_CONCURRENT = 3;
const MAX_TASK_TEST_ATTEMPTS = 3;
const MAX_FINAL_TEST_ATTEMPTS = 3;
const FULL_BOARD_TEST_ID = 'FULL_BOARD';

/** Task columns that may still have linked chats or worktrees after reload. */
const WORKTREE_REHYDRATE_STATUSES = new Set<BoardTaskStatus>([
  'in_progress',
  'testing',
  'merging',
]);

/** Bind an absolute worktree path onto every chat linked to a board task. */
function bindTaskWorktreeToLinkedChats(task: BoardTask, worktreeRoot: string): void {
  const wt = worktreeRoot.trim();
  if (!wt) return;
  for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
    const id = chatId?.trim();
    if (!id) continue;
    const chat = findChatById(id);
    if (chat) chat.worktreeRoot = wt;
  }
}

/**
 * Re-attach isolated worktrees after reload: server ops plus persisted paths on
 * tasks/chats. Runs before generation or board boot resume so tools stay scoped.
 */
export async function rehydrateBoardWorktreeRoots(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board || !isIsolationActive(board)) return;

  let changed = false;
  for (const task of board.tasks) {
    if (!WORKTREE_REHYDRATE_STATUSES.has(task.status)) continue;

    const ensured =
      (await ensureTaskWorktree(group, task, plannerChat)) ||
      task.worktreePath?.trim() ||
      undefined;
    if (!ensured) continue;

    bindTaskWorktreeToLinkedChats(task, ensured);
    changed = true;
  }

  if (changed) scheduleSaveSessions();
}

/** Rehydrate worktrees for every board with active isolated tasks (boot). */
export async function rehydrateAllBoardWorktreeRoots(state: SessionState): Promise<void> {
  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await rehydrateBoardWorktreeRoots(group, planner);
  }
}

/** Per-board folder id → queued task ids waiting for a concurrency slot. */
const taskQueueByGroupId = new Map<string, string[]>();

/** Per-board serialized integration merges (keyed by group id). */
const mergeQueueByGroupId = new Map<string, Promise<unknown>>();

export type MergeTaskWorktreeResult =
  | { outcome: 'merged' }
  | { outcome: 'conflict'; conflictedFiles: string[]; integrationSha?: string }
  | { outcome: 'skipped' }
  | { outcome: 'error'; message: string };

function boardHasActiveFixer(board: OrchestrateBoardState): boolean {
  return board.tasks.some(
    (t) => t.status === 'merging' && Boolean(t.fixerChatId?.trim()),
  );
}

/** Block new merges while a fixer chat is resolving a conflict in integration. */
async function waitForNoActiveFixer(group: ChatGroup): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  while (boardHasActiveFixer(board)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function enqueueBoardMerge<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  const prev = mergeQueueByGroupId.get(groupId) ?? Promise.resolve();
  const run = prev.then(() => fn());
  mergeQueueByGroupId.set(
    groupId,
    run.then(() => undefined).catch(() => undefined),
  );
  return run;
}

/** Chat ids holding a launch slot until runChatTurn registers streaming/setup. */
const reservedLaunchChatIds = new Set<string>();

function reserveLaunchSlot(chatId: string): void {
  reservedLaunchChatIds.add(chatId);
}

function releaseLaunchSlot(chatId: string): void {
  reservedLaunchChatIds.delete(chatId);
}

function isLaunchReserved(chatId: string): boolean {
  return reservedLaunchChatIds.has(chatId);
}

let streamEndSubscribed = false;
let streamActivitySubscribed = false;
let autoDriveSubscribed = false;

async function refreshHeartbeatThresholds(): Promise<void> {
  const config = await loadSubAgentConfig();
  setHeartbeatConfig({
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    progressStallMs: config.progressStallMs,
    heartbeatDeadMs: config.heartbeatDeadMs,
  });
}

function stopTaskChatSupervision(chatId: string): void {
  stopHeartbeat(chatTaskRunId(chatId));
}

/** How a linked task chat ended its latest assistant turn. */
export type TaskChatStreamOutcome = 'completed' | 'stopped' | 'failed';

/** Infer stream outcome from the task chat transcript (last assistant turn). */
export function resolveTaskChatStreamOutcome(chat: Chat): TaskChatStreamOutcome {
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role === 'assistant') {
      if ('stopped' in msg && msg.stopped) return 'stopped';
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content == null
            ? ''
            : JSON.stringify(msg.content);
      if (
        content.includes('Maximum tool turns reached') ||
        content.includes('Could not complete this reply')
      ) {
        return 'failed';
      }
      return 'completed';
    }
    if (msg.role === 'user') break;
  }
  return 'failed';
}

/**
 * Advance board task status when its linked **Builder** chat finishes streaming.
 * Successful builds move to testing; auto-pilot launches the Tester.
 */
export function finalizeBoardTaskOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): void {
  if (task.status !== 'in_progress') return;

  const chatId = task.chatId?.trim();
  if (!chatId) return;
  const chat = findChatById(chatId);
  if (!chat) return;

  const outcome = resolveTaskChatStreamOutcome(chat);

  if (outcome === 'stopped') {
    updateTask(group, task.id, { endedAt: Date.now() }, plannerChat);
    return;
  }

  if (outcome === 'failed') {
    moveTaskStatus(group, task.id, 'failed', plannerChat);
    updateTask(
      group,
      task.id,
      {
        endedAt: Date.now(),
        error: 'Task chat ended without completing successfully',
      },
      plannerChat,
    );
    return;
  }

  updateTask(
    group,
    task.id,
    { endedAt: Date.now(), error: undefined, testVerdict: undefined, testSummary: undefined },
    plannerChat,
  );
  moveTaskStatus(group, task.id, 'testing', plannerChat);

  const builderChat = findChatById(chatId);
  if (builderChat) {
    const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
    const lastAssistant = [...builderChat.history].reverse().find((m) => m.role === 'assistant');
    const assistantText = lastAssistant && typeof lastAssistant.content === 'string'
      ? lastAssistant.content
      : '';
    schedulePostTurnSynthesis({
      chatId: builderChat.id,
      messages: buildSynthesisMessages(builderChat),
      roundCount: builderChat.history.filter((m) => m.role === 'assistant').length,
      toolCount: 0,
      sourceExcerpt: buildSynthesisExcerpt(builderChat),
      assistantText,
      force: true,
      providerId: providerId || undefined,
      modelId: modelId || undefined,
    });
  }

  if (isBoardRunning(group)) {
    void startTaskTesting(group, task.id, plannerChat).catch((err) =>
      reportBackgroundError('start-task-testing', err),
    );
  }
}

function startTaskChatSupervision(chatId: string): void {
  const runId = chatTaskRunId(chatId);
  const supervision = createRunSupervision();
  bindRunSupervision(runId, supervision);
  startHeartbeat(runId, () => {
    const chat = findChatById(chatId);
    if (!chat?.boardGroupId) return;
    emitBoardChange(chat.boardGroupId);
  });
}

function isTaskChatStreaming(chatId: string): boolean {
  return (
    isChatStreaming(chatId) ||
    isChatTurnSetupPending(chatId) ||
    isLaunchReserved(chatId)
  );
}

/** Provider/model for a board task chat — planner binding, then top-bar model select. */
function resolvePlannerModelBinding(plannerChat: Chat): {
  providerId: string;
  modelId: string;
} {
  let providerId = plannerChat.providerId?.trim() ?? '';
  let modelId = plannerChat.modelId?.trim() ?? '';
  if (!modelId) {
    const domRaw =
      (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim() ??
      '';
    if (domRaw) {
      const parsed = decodeModelSelectKey(domRaw);
      if (parsed) {
        providerId = providerId || parsed.providerId;
        modelId = parsed.modelId;
      } else {
        modelId = domRaw;
      }
    }
  }
  return { providerId, modelId };
}

/** Keep task/test/final chats aligned with the planner model before launching a turn. */
function syncTaskChatModelFromPlanner(taskChat: Chat, plannerChat: Chat): void {
  const binding = resolvePlannerModelBinding(plannerChat);
  if (binding.providerId) taskChat.providerId = binding.providerId;
  if (binding.modelId) taskChat.modelId = binding.modelId;
}

type BoardChatRole = 'build' | 'tester' | 'fixer';

function getOrCreateBoardChat(input: {
  group: ChatGroup;
  plannerChat: Chat;
  existingId?: string;
  role: BoardChatRole;
  name: string;
  taskId?: string;
  taskChatField?: 'chatId' | 'testChatId' | 'fixerChatId';
}): Chat {
  const { providerId, modelId } = resolvePlannerModelBinding(input.plannerChat);
  const folderId = input.group.id;
  const existingId = input.existingId?.trim();

  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) {
      if (input.taskId) existing.boardTaskId = input.taskId;
      if (input.role === 'tester') existing.workAgentId = 'tester';
      if (input.role === 'fixer') existing.workAgentId = null;
      syncTaskChatModelFromPlanner(existing, input.plannerChat);
      return existing;
    }
  }

  const chat = createEmptyChatObject(modelId, input.plannerChat.workspacePath);
  chat.providerId = providerId;
  chat.modeId = 'build';
  chat.workAgentId = input.role === 'tester' ? 'tester' : null;
  chat.name = input.name;
  chat.groupId = folderId;
  chat.boardGroupId = folderId;
  if (input.taskId) chat.boardTaskId = input.taskId;
  requireSession().chats.unshift(chat);
  if (input.taskId && input.taskChatField) {
    updateTask(
      input.group,
      input.taskId,
      { [input.taskChatField]: chat.id },
      input.plannerChat,
    );
  }
  assignChatToGroup(chat.id, folderId);
  return chat;
}

function ensureStreamEndSubscription(): void {
  if (!streamEndSubscribed) {
    streamEndSubscribed = true;
    subscribeChatStreamEnd((endedChatId) => {
      stopTaskChatSupervision(endedChatId);
      if (!sessionState) return;
      // Drain now, then again after a microtask: notifyChatStreamEnded fires
      // before setStreaming(false) clears the ended chat, so in sequential mode
      // the concurrency check sees count=1 and enqueues instead of starting.
      // Re-drain after the flag clears. Rejections are logged, never swallowed.
      const safeDrain = (g: ChatGroup, p: Chat): void => {
        void drainTaskQueue(g, p).catch((err) =>
          reportBackgroundError('drain-task-queue', err),
        );
        queueMicrotask(() =>
          void drainTaskQueue(g, p).catch((err) =>
            reportBackgroundError('drain-task-queue', err),
          ),
        );
      };
      for (const group of sessionState.groups ?? []) {
        const board = group.orchestrateBoard;
        if (!board) continue;
        const planner = getPlannerChatForGroup(group);
        if (!planner) continue;

        const finalChatId = board.finalTest?.chatId?.trim();
        if (finalChatId && endedChatId === finalChatId) {
          finalizeFinalTestOnStreamEnd(group, planner);
          safeDrain(group, planner);
          continue;
        }

        const taskByBuild = board.tasks.find((t) => t.chatId === endedChatId);
        if (taskByBuild) {
          finalizeBoardTaskOnStreamEnd(group, taskByBuild, planner);
          safeDrain(group, planner);
          continue;
        }

        const taskByTest = board.tasks.find((t) => t.testChatId === endedChatId);
        if (taskByTest) {
          void finalizeTaskTestingOnStreamEnd(group, taskByTest, planner)
            .then(() => safeDrain(group, planner))
            .catch((err) => reportBackgroundError('finalize-task-testing', err));
          continue;
        }

        const taskByFixer = board.tasks.find((t) => t.fixerChatId === endedChatId);
        if (taskByFixer) {
          void finalizeMergeFixerOnStreamEnd(group, taskByFixer, planner)
            .then(() => safeDrain(group, planner))
            .catch((err) => reportBackgroundError('finalize-merge-fixer', err));
        }
      }
    });
  }
  if (!streamActivitySubscribed) {
    streamActivitySubscribed = true;
    subscribeChatStreamActivity((chatId) => {
      const chat = findChatById(chatId);
      if (!chat?.boardTaskId) return;
      bumpProgress(chatTaskRunId(chatId));
      if (chat.boardGroupId) emitBoardChange(chat.boardGroupId);
    });
  }
}

function maxConcurrent(board: NonNullable<ChatGroup['orchestrateBoard']>): number {
  if (board.executionMode === 'sequential') return 1;
  const n = board.maxConcurrentTasks;
  return typeof n === 'number' && n > 0 ? n : DEFAULT_MAX_CONCURRENT;
}

/** Skip launching background chat turns under node:test (avoids open handles). */
function skipBackgroundBoardChatLaunch(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.MINNOW_TEST === '1'
  );
}

/** Running task / tester / final-integration chats occupying a concurrency slot. */
export function countRunningTaskChats(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  const seen = new Set<string>();
  let n = 0;
  const countActive = (raw?: string): void => {
    const id = raw?.trim();
    if (!id || seen.has(id)) return;
    if (isTaskChatStreaming(id)) {
      seen.add(id);
      n += 1;
    }
  };
  for (const task of board.tasks) {
    countActive(task.chatId);
    countActive(task.testChatId);
    countActive(task.fixerChatId);
  }
  countActive(board.finalTest?.chatId);
  return n;
}

/** True when a task-linked chat is starting or streaming (occupies a concurrency slot). */
export function isTaskChatActive(chatId: string): boolean {
  return isTaskChatStreaming(chatId);
}

function resolveBoardContext(plannerOrMemberChat: Chat): {
  group: ChatGroup;
  planner: Chat;
} | null {
  const group = getBoardGroupForChat(plannerOrMemberChat);
  if (!group?.orchestrateBoard) return null;
  const planner =
    getPlannerChatForGroup(group) ??
    (plannerOrMemberChat.boardGroupId === group.id ? plannerOrMemberChat : null);
  if (!planner) return null;
  return { group, planner };
}

export function buildTaskSeedMessage(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const build = task.buildSpec?.trim() || '(see plan)';
  const test = task.testSpec?.trim() || '(see plan)';
  return [
    'Execute this orchestrate task.',
    '',
    `Plan: ${planPath}`,
    `Task: ${task.id} — ${task.title}`,
    `Wave: ${task.wave}`,
    '',
    'Build:',
    build,
    '',
    'Test:',
    test,
    '',
    'Read the plan file for full context if needed. Report what you changed.',
  ].join('\n');
}

/** Compact Builder seed after a per-task test failure (fresh chat, no history bloat). */
export function buildRetryBuilderSeedMessage(task: BoardTask, attempt: number, testSummary: string): string {
  const build = task.buildSpec?.trim() || '(see plan)';
  return [
    'Fix this orchestrate task after a failed test.',
    '',
    `Task: ${task.id} — ${task.title}`,
    '',
    'Build:',
    build,
    '',
    `Previous attempt failed testing (${attempt}/${MAX_TASK_TEST_ATTEMPTS}): ${testSummary}`,
    '',
    'Fix the issues and report what you changed.',
  ].join('\n');
}

/** Seed for per-task Tester (headless — no browser). */
export function buildTaskTestSeedMessage(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const test = task.testSpec?.trim() || '(derive checks from build spec and changed files)';
  const build = task.buildSpec?.trim() || '(see plan)';
  return [
    'Run per-task testing (headless — no browser, no dev server).',
    '',
    `Plan: ${planPath}`,
    `Task: ${task.id} — ${task.title}`,
    '',
    'Build (what the Builder implemented):',
    build,
    '',
    'Test spec:',
    test,
    '',
    'Verify with git_diff, static integration review, and project scripts (typecheck → lint → unit → build).',
    `Report exactly once via board_report_test_result({ task_id: "${task.id}", verdict: "pass" | "fail", summary: "..." }).`,
  ].join('\n');
}

/** Seed for full-board final integration test (includes browser smoke). */
export function buildFinalIntegrationTestSeedMessage(
  group: ChatGroup,
  plannerChat: Chat,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const taskList = board.tasks
    .map((t) => `- ${t.id}: ${t.title} (${t.status})`)
    .join('\n');
  return [
    'Run final full-board integration testing (includes browser smoke when available).',
    '',
    `Plan: ${planPath}`,
    '',
    'Board tasks:',
    taskList,
    '',
    'Exercise the whole app end-to-end. On failure, identify responsible task ids via board_get_state.',
    `Report exactly once via board_report_test_result({ task_id: "${FULL_BOARD_TEST_ID}", verdict: "pass" | "fail", summary: "...", failing_tasks: [...] }).`,
  ].join('\n');
}

/** Resume a queued or stalled board task (Builder vs Tester by column). */
async function resumeBoardTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.status === 'testing') {
    await startTaskTesting(group, taskId, plannerChat);
    return;
  }
  await startTask(group, taskId, plannerChat);
}

async function drainTaskQueue(group: ChatGroup, plannerChat: Chat): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const queue = taskQueueByGroupId.get(group.id);
  if (!queue?.length) return;
  // Promote tasks already in testing ahead of queued builds so each task keeps
  // its single slot across build→test→complete. Needed because
  // notifyChatStreamEnded fires before setStreaming(false), causing
  // startTaskTesting to enqueue at the back while the build chat still appears
  // active; the deferred microtask drain then needs the correct order.
  if (queue.length > 1) {
    queue.sort((a, b) => {
      const sa = board.tasks.find((t) => t.id === a)?.status;
      const sb = board.tasks.find((t) => t.id === b)?.status;
      return (sa === 'testing' ? 0 : 1) - (sb === 'testing' ? 0 : 1);
    });
  }
  while (queue.length > 0 && countRunningTaskChats(board) < maxConcurrent(board)) {
    const nextId = queue.shift()!;
    await resumeBoardTask(group, nextId, plannerChat);
  }
  if (!queue.length) {
    taskQueueByGroupId.delete(group.id);
  }
}

function enqueueTask(groupId: string, taskId: string): void {
  const q = taskQueueByGroupId.get(groupId) ?? [];
  if (!q.includes(taskId)) q.push(taskId);
  taskQueueByGroupId.set(groupId, q);
}

/**
 * Ensure an isolated git worktree for a task when board isolation is active, and
 * return its absolute path (also persisted on the task). Best-effort: returns null
 * when isolation is off or any git/server step fails, so the task falls back to the
 * shared workspace and execution is never blocked (MIN-275).
 */
async function ensureTaskWorktree(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<string | null> {
  const board = group.orchestrateBoard;
  if (!board) return null;
  const mode = resolveIsolationMode(board);
  if (mode === 'off') return null;

  const boardId = group.id;
  const branch = worktreeBranchFor(mode, boardId, task);
  const slotId = worktreeSlotId(mode, task);
  if (!branch || !slotId) return null;

  // Mint the integration branch + its worktree once per board (lazy).
  const integrationBranch = board.integrationBranch ?? boardIntegrationBranch(boardId);
  if (!board.integrationBranch) {
    const ensured = await ensureIntegrationWorktree({ boardId, branch: integrationBranch });
    if (!ensured.ok) return null;
    board.integrationBranch = integrationBranch;
    scheduleSaveSessions();
  }

  // Per-wave mode: reuse a sibling task's already-created worktree for this wave.
  const shared = board.tasks.find(
    (t) => t.id !== task.id && t.worktreeBranch === branch && Boolean(t.worktreePath),
  );
  if (shared?.worktreePath) {
    const synced = await createTaskWorktreeOp({
      boardId,
      slotId,
      branch,
      baseRef: integrationBranch,
    });
    const path = synced.ok && synced.path ? synced.path : shared.worktreePath;
    updateTask(
      group,
      task.id,
      { worktreePath: path, worktreeBranch: branch, devPort: shared.devPort },
      plannerChat,
    );
    return path;
  }

  const created = await createTaskWorktreeOp({
    boardId,
    slotId,
    branch,
    baseRef: integrationBranch,
  });
  if (!created.ok || !created.path) return null;

  const freshTask = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  const devPort =
    freshTask.devPort ??
    allocateDevPort(DEFAULT_BOARD_PORT_BASE, usedDevPorts(board.tasks));
  if (
    freshTask.worktreePath !== created.path ||
    freshTask.worktreeBranch !== branch ||
    freshTask.devPort !== devPort
  ) {
    updateTask(
      group,
      task.id,
      { worktreePath: created.path, worktreeBranch: branch, devPort },
      plannerChat,
    );
  }
  return created.path;
}

/**
 * Fold a passed task's branch into integration. Returns whether the merge landed.
 * Auto-commits the task worktree first (per-task isolation only). Serialized per board.
 */
async function mergeCompletedTaskWorktree(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<MergeTaskWorktreeResult> {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) return { outcome: 'skipped' };
  const branch = task.worktreeBranch;
  if (!branch || branch === board.integrationBranch) return { outcome: 'skipped' };

  const mode = resolveIsolationMode(board);
  const boardId = group.id;

  if (mode === 'per-task') {
    const slotId = worktreeSlotId(mode, task);
    if (slotId) {
      try {
        await commitTaskWorktree({
          boardId,
          slotId,
          message: `Board task ${task.id}: ${task.title}`,
        });
      } catch (err) {
        reportBackgroundError('worktree-commit', err);
      }
    }
  } else if (mode !== 'off') {
    reportBackgroundError(
      'worktree-commit',
      new Error(`Skipping auto-commit for task ${task.id}: isolation mode is ${mode}`),
    );
  }

  try {
    const res = await mergeTaskIntoIntegration({
      boardId,
      fromBranch: branch,
      message: `Merge ${task.id} (${task.title}) into integration`,
    });
    if (res.ok) {
      const verified = await verifyIntegrationMergeOp({ boardId, fromBranch: branch });
      if (verified.ok && verified.verified) {
        try {
          await refreshIntegrationDepsOp({ boardId, sinceSha: res.integrationSha });
        } catch (err) {
          reportBackgroundError('worktree-refresh-deps', err);
        }
        return { outcome: 'merged' };
      }
      const reasons = verified.reasons?.join('; ') || 'Integration merge verification failed';
      if (res.integrationSha) {
        await restoreIntegrationWorktree({ boardId, sha: res.integrationSha }).catch((err) =>
          reportBackgroundError('worktree-restore-integration', err),
        );
      }
      return { outcome: 'error', message: reasons };
    }
    if (res.conflict) {
      return {
        outcome: 'conflict',
        conflictedFiles: res.conflictedFiles ?? [],
        integrationSha: res.integrationSha,
      };
    }
    return {
      outcome: 'error',
      message: res.error ?? res.output ?? 'Integration merge failed',
    };
  } catch (err) {
    reportBackgroundError('worktree-merge', err);
    return {
      outcome: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run mergeCompletedTaskWorktree on the per-board merge queue (waits for fixers). */
function enqueueMergeCompletedTaskWorktree(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<MergeTaskWorktreeResult> {
  return enqueueBoardMerge(group.id, async () => {
    await waitForNoActiveFixer(group);
    return mergeCompletedTaskWorktree(group, task, plannerChat);
  });
}

/** Seed for a merge-conflict fixer chat (runs in the integration worktree). */
function buildMergeFixerSeedMessage(
  task: BoardTask,
  conflictedFiles: string[],
): string {
  const branch = task.worktreeBranch?.trim() || '(unknown branch)';
  const fileList =
    conflictedFiles.length > 0
      ? conflictedFiles.map((f) => `- ${f}`).join('\n')
      : '- (run git status to list conflicted files)';
  return [
    `Resolve the in-progress git merge of \`${branch}\` into integration.`,
    '',
    'The merge is already in progress in this integration worktree (MERGE_HEAD is set).',
    'Do not run `git merge`, `git reset`, `git checkout`, or `git merge --abort` —',
    'those commands destroy the in-progress merge state.',
    '',
    'Conflicted files:',
    fileList,
    '',
    'Steps:',
    '1. Resolve conflict markers in the listed files (and handle add/delete conflicts via `git add` / `git rm`).',
    '2. `git add` each resolved path.',
    '3. Finish with `git commit --no-edit` (uses the prepared merge message and records both parents).',
    '',
    'Touch only conflicted regions. Do not run git push.',
  ].join('\n');
}

/** Spawn a fixer chat to resolve an integration merge conflict. */
async function startMergeConflictFixer(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  conflictedFiles: string[],
  integrationSha?: string,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) return;

  const ensured = await ensureIntegrationWorktree({
    boardId: group.id,
    branch: board.integrationBranch,
  });
  const integrationPath = ensured.path?.trim();
  if (!integrationPath) {
    moveTaskStatus(group, task.id, 'blocked', plannerChat);
    updateTask(
      group,
      task.id,
      { error: 'Integration worktree missing; cannot spawn merge fixer' },
      plannerChat,
    );
    return;
  }

  moveTaskStatus(group, task.id, 'merging', plannerChat);

  const preSha = integrationSha?.trim() || task.mergePreSha?.trim();
  if (preSha) {
    updateTask(group, task.id, { mergePreSha: preSha }, plannerChat);
  }

  const fixerChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: task.fixerChatId?.trim(),
    role: 'fixer',
    name: `Fix merge ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'fixerChatId',
  });

  fixerChat.worktreeRoot = integrationPath;
  scheduleSaveSessions();

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();
  reserveLaunchSlot(fixerChat.id);
  try {
    const seed = buildMergeFixerSeedMessage(task, conflictedFiles);
    void runChatTurn({
      chat: fixerChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: `Fix merge ${task.id}`,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Merge fixer chat failed to start';
      updateTask(group, task.id, { error: message }, plannerChat);
    }).finally(() => releaseLaunchSlot(fixerChat.id));
  } catch (err) {
    releaseLaunchSlot(fixerChat.id);
    throw err;
  }
}

/** Route merge fixer stream-end: confirm merge or block the task. */
async function finalizeMergeFixerOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  if (task.status !== 'merging') return;
  const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  const branch = fresh.worktreeBranch?.trim();
  if (!branch) {
    moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
    return;
  }

  const boardId = group.id;
  const attempts = fresh.fixerAttempts ?? 0;

  try {
    const merged = await checkTaskBranchMerged({ boardId, fromBranch: branch });
    const verified =
      merged.ok && merged.merged
        ? await verifyIntegrationMergeOp({ boardId, fromBranch: branch })
        : null;

    if (merged.ok && merged.merged && verified?.ok && verified.verified) {
      const mergePreSha = fresh.mergePreSha?.trim();
      try {
        await refreshIntegrationDepsOp({ boardId, sinceSha: mergePreSha });
      } catch (err) {
        reportBackgroundError('worktree-refresh-deps', err);
      }
      updateTask(
        group,
        fresh.id,
        {
          fixerChatId: undefined,
          error: undefined,
          fixerAttempts: undefined,
          mergePreSha: undefined,
        },
        plannerChat,
      );
      moveTaskStatus(group, fresh.id, 'complete', plannerChat);
      return;
    }

    const preSha = fresh.mergePreSha?.trim();
    if (preSha) {
      await restoreIntegrationWorktree({ boardId, sha: preSha }).catch((err) =>
        reportBackgroundError('worktree-restore-integration', err),
      );
    }

    if (attempts < MAX_MERGE_FIXER_ATTEMPTS - 1) {
      const nextAttempts = attempts + 1;
      updateTask(
        group,
        fresh.id,
        {
          fixerChatId: undefined,
          fixerAttempts: nextAttempts,
          error: undefined,
        },
        plannerChat,
      );

      const mergeResult = await enqueueMergeCompletedTaskWorktree(group, fresh, plannerChat);
      if (mergeResult.outcome === 'conflict') {
        await startMergeConflictFixer(
          group,
          fresh,
          plannerChat,
          mergeResult.conflictedFiles,
          mergeResult.integrationSha,
        );
        return;
      }

      const retryMsg =
        mergeResult.outcome === 'error'
          ? mergeResult.message
          : 'Re-merge after fixer failure did not produce a conflict for retry';
      updateTask(
        group,
        fresh.id,
        { error: retryMsg, fixerAttempts: undefined, mergePreSha: undefined },
        plannerChat,
      );
      moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
      return;
    }

    const summary =
      fresh.error?.trim() ||
      verified?.reasons?.join('; ') ||
      'Merge fixer could not produce a valid integration merge after 2 attempts';
    updateTask(
      group,
      fresh.id,
      {
        fixerChatId: undefined,
        error: summary,
        fixerAttempts: undefined,
        mergePreSha: undefined,
      },
      plannerChat,
    );
    moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
  } catch (err) {
    reportBackgroundError('finalize-merge-fixer', err);
    moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
  }
}

/**
 * Remove all per-task/wave worktrees for a board (keeps the integration branch +
 * worktree so MIN-208 can commit/push from it). Call on board teardown/delete.
 */
export function cleanupBoardIsolation(group: ChatGroup): void {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) return;
  void cleanupBoardWorktreesOp({ boardId: group.id }).catch((err) =>
    reportBackgroundError('worktree-cleanup', err),
  );
}

/** Start a linked task chat (background stream; does not switch active chat). */
export async function startTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const existingChatId = task.chatId?.trim();
  if (existingChatId && isTaskChatActive(existingChatId)) {
    return;
  }

  if (countRunningTaskChats(board) >= maxConcurrent(board)) {
    enqueueTask(group.id, taskId);
    return;
  }

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    updateTask(
      group,
      taskId,
      { error: 'Select a model for the orchestrate planner before starting tasks' },
      plannerChat,
    );
    return;
  }

  // A retry/reopen seed (failed-test summary) is persisted on the task so it
  // survives being queued for a concurrency slot. When present, run a fresh
  // Builder chat (no history bloat) with the failure-aware prompt.
  const overrideSeed = task.pendingBuildSeed?.trim() || '';

  let taskChat: Chat;
  const forceNewChat = Boolean(overrideSeed);
  taskChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: forceNewChat ? '' : task.chatId?.trim(),
    role: 'build',
    name: `Task ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'chatId',
  });

  reserveLaunchSlot(taskChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    // Scope this task chat's tools to an isolated worktree when board isolation is on
    // (MIN-275). Best-effort: a null result leaves the chat on the shared workspace.
    const worktreeRoot = await ensureTaskWorktree(group, task, plannerChat);
    if (worktreeRoot) {
      taskChat.worktreeRoot = worktreeRoot;
      scheduleSaveSessions();
    }

    const seed = overrideSeed || buildTaskSeedMessage(group, plannerChat, task);
    // Consume the one-shot retry seed now that the build is actually launching.
    if (overrideSeed) {
      updateTask(group, taskId, { pendingBuildSeed: undefined }, plannerChat);
    }

    void refreshHeartbeatThresholds().then(() => {
      startTaskChatSupervision(taskChat.id);
    });

    void runChatTurn({
      chat: taskChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: task.title,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message =
        err instanceof Error ? err.message : 'Task chat failed to start';
      updateTask(
        group,
        taskId,
        { error: message || 'Task chat failed to start' },
        plannerChat,
      );
    }).finally(() => releaseLaunchSlot(taskChat.id));
  } catch (err) {
    releaseLaunchSlot(taskChat.id);
    throw err;
  }
}

/** Start Tester chat for a task in the testing column. */
export async function startTaskTesting(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'testing') return;

  const existingTestId = task.testChatId?.trim();
  if (existingTestId && isTaskChatActive(existingTestId)) return;

  if (countRunningTaskChats(board) >= maxConcurrent(board)) {
    enqueueTask(group.id, taskId);
    return;
  }

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    updateTask(
      group,
      taskId,
      { error: 'Select a model for the orchestrate planner before running tests' },
      plannerChat,
    );
    return;
  }

  const testChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: task.testChatId?.trim(),
    role: 'tester',
    name: `Test ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'testChatId',
  });

  updateTask(
    group,
    taskId,
    { testVerdict: undefined, testSummary: undefined },
    plannerChat,
  );

  reserveLaunchSlot(testChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    // Tester runs against the same isolated worktree as the Builder (MIN-275).
    const freshTask = group.orchestrateBoard?.tasks.find((t) => t.id === taskId) ?? task;
    const buildChat = freshTask.chatId ? findChatById(freshTask.chatId) : undefined;
    const worktreeRoot =
      freshTask.worktreePath?.trim() ||
      buildChat?.worktreeRoot?.trim() ||
      (await ensureTaskWorktree(group, freshTask, plannerChat)) ||
      undefined;
    if (worktreeRoot) {
      testChat.worktreeRoot = worktreeRoot;
      scheduleSaveSessions();
    }

    const seed = buildTaskTestSeedMessage(group, plannerChat, task);

    void refreshHeartbeatThresholds().then(() => {
      startTaskChatSupervision(testChat.id);
    });

    void runChatTurn({
      chat: testChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: `Test ${task.id}`,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message =
        err instanceof Error ? err.message : 'Tester chat failed to start';
      updateTask(
        group,
        taskId,
        { error: message || 'Tester chat failed to start' },
        plannerChat,
      );
    }).finally(() => releaseLaunchSlot(testChat.id));
  } catch (err) {
    releaseLaunchSlot(testChat.id);
    throw err;
  }
}

/** Manual entry: Run tests on a task in the testing column. */
export async function startTaskTestingForPlannerChat(
  plannerChat: Chat,
  taskId: string,
): Promise<void> {
  const ctx = resolveBoardContext(plannerChat);
  if (!ctx) return;
  await startTaskTesting(ctx.group, taskId, ctx.planner);
}

/** Apply per-task test failure bookkeeping; returns next routing step. */
export function applyTaskTestFailureState(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  summary: string,
): 'blocked' | 'retry' {
  const attempts = (task.testAttempts ?? 0) + 1;
  updateTask(
    group,
    task.id,
    { testAttempts: attempts, testSummary: summary },
    plannerChat,
  );

  if (attempts >= MAX_TASK_TEST_ATTEMPTS) {
    moveTaskStatus(group, task.id, 'blocked', plannerChat);
    updateTask(group, task.id, { error: summary }, plannerChat);
    return 'blocked';
  }

  moveTaskStatus(group, task.id, 'in_progress', plannerChat);
  return 'retry';
}

/**
 * Fallback verdict parsed from the Tester chat transcript when the structured
 * `board_report_test_result` call never landed. Requires an explicit
 * `VERDICT: pass|fail` marker in the latest assistant message — prose alone is
 * not trusted, so an offhand "tests pass" mid-explanation is not read as the
 * final verdict. Returns null when no marker is present.
 */
function parseTesterVerdictMarker(chatId: string | undefined): {
  verdict: 'pass' | 'fail';
  summary: string;
} | null {
  const id = chatId?.trim();
  if (!id) return null;
  const chat = findChatById(id);
  if (!chat) return null;
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (!content.trim()) continue;
    // Only inspect the most recent non-empty assistant message.
    const match = content.match(/^[ \t>*_-]*verdict\s*[:=]\s*([a-z]+)/im);
    const verdict = match ? normalizeVerdict(match[1]) : null;
    if (!verdict) return null;
    const line = content
      .split(/\r?\n/)
      .find((l) => /verdict\s*[:=]/i.test(l))
      ?.trim();
    return { verdict, summary: line || `Tester message verdict: ${verdict}` };
  }
  return null;
}

/** Route per-task Tester verdict after its chat stream ends. */
export async function finalizeTaskTestingOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  if (task.status !== 'testing') return;
  const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  let verdict = fresh.testVerdict;
  let summary = fresh.testSummary?.trim() || 'Tester did not report a verdict';

  // No structured verdict recorded: fall back to an explicit transcript marker
  // before treating the run as a failure. Do not override an explicit 'fail'.
  if (!verdict) {
    const parsed = parseTesterVerdictMarker(fresh.testChatId);
    if (parsed) {
      verdict = parsed.verdict;
      summary = parsed.summary;
      updateTask(
        group,
        fresh.id,
        { testVerdict: parsed.verdict, testSummary: parsed.summary },
        plannerChat,
      );
    }
  }

  if (verdict === 'pass') {
    updateTask(group, fresh.id, { error: undefined }, plannerChat);
    const mergeResult = await enqueueMergeCompletedTaskWorktree(group, fresh, plannerChat);
    if (mergeResult.outcome === 'merged' || mergeResult.outcome === 'skipped') {
      moveTaskStatus(group, fresh.id, 'complete', plannerChat);
    } else if (mergeResult.outcome === 'conflict') {
      updateTask(
        group,
        fresh.id,
        {
          error: `Integration merge conflict on ${fresh.worktreeBranch ?? fresh.id}`,
        },
        plannerChat,
      );
      await startMergeConflictFixer(
        group,
        fresh,
        plannerChat,
        mergeResult.conflictedFiles,
        mergeResult.integrationSha,
      );
    } else {
      moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
      updateTask(
        group,
        fresh.id,
        { error: mergeResult.message || 'Integration merge failed' },
        plannerChat,
      );
    }

    const testChatId = fresh.testChatId?.trim();
    const testChat = testChatId ? findChatById(testChatId) : null;
    if (testChat) {
      const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
      const lastAssistant = [...testChat.history].reverse().find((m) => m.role === 'assistant');
      const assistantText = lastAssistant && typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : '';
      schedulePostTurnSynthesis({
        chatId: testChat.id,
        messages: buildSynthesisMessages(testChat),
        roundCount: testChat.history.filter((m) => m.role === 'assistant').length,
        toolCount: 0,
        sourceExcerpt: buildSynthesisExcerpt(testChat),
        assistantText,
        force: true,
        providerId: providerId || undefined,
        modelId: modelId || undefined,
      });
    }
    return;
  }

  const route = applyTaskTestFailureState(group, fresh, plannerChat, summary);
  if (route === 'retry') {
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === fresh.id) ?? fresh;
    const seed = buildRetryBuilderSeedMessage(
      updated,
      updated.testAttempts ?? 1,
      summary,
    );
    // Persist the failure-aware seed so it survives a concurrency-slot queue
    // (the just-ended Tester chat is still counted as running here).
    updateTask(group, fresh.id, { pendingBuildSeed: seed }, plannerChat);
    void startTask(group, fresh.id, plannerChat).catch((err) =>
      reportBackgroundError('start-task-retry', err),
    );
  }
}

/** Start full-board final integration test (Tester with browser). */
export async function startFinalIntegrationTest(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board || !isOrchestratePlanComplete(board)) return;
  if (board.finalTest?.status === 'in_progress') return;
  if (board.finalTest?.status === 'passed') return;

  const existingFinalId = board.finalTest?.chatId?.trim();
  if (existingFinalId && isTaskChatActive(existingFinalId)) return;

  if (countRunningTaskChats(board) >= maxConcurrent(board)) return;

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    board.finalTest = {
      ...(board.finalTest ?? {}),
      status: 'failed',
      summary: 'Select a model for the orchestrate planner before running the final test',
    };
    board.lastUpdatedAt = Date.now();
    scheduleSaveSessions();
    emitBoardChange(group.id);
    return;
  }

  const finalChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: existingFinalId,
    role: 'tester',
    name: 'Final integration test',
  });

  // Run the final test in the integration worktree (where all task branches were
  // merged), not the main checkout. Only applies when board isolation is active.
  if (board.integrationBranch) {
    const ensured = await ensureIntegrationWorktree({
      boardId: group.id,
      branch: board.integrationBranch,
    });
    const integrationPath = ensured.path?.trim();
    if (!integrationPath) {
      // Fail fast — never silently fall back to the un-integrated main checkout.
      board.finalTest = {
        ...(board.finalTest ?? {}),
        status: 'failed',
        summary: 'Integration worktree missing; cannot run final integration test',
      };
      board.lastUpdatedAt = Date.now();
      scheduleSaveSessions();
      emitBoardChange(group.id);
      return;
    }
    finalChat.worktreeRoot = integrationPath;
  }

  board.finalTest = {
    ...(board.finalTest ?? {}),
    status: 'in_progress',
    chatId: finalChat.id,
    recordedVerdict: undefined,
    failingTaskIds: undefined,
    summary: undefined,
  };
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);

  reserveLaunchSlot(finalChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    const seed = buildFinalIntegrationTestSeedMessage(group, plannerChat);

    void refreshHeartbeatThresholds().then(() => {
      startTaskChatSupervision(finalChat.id);
    });

    void runChatTurn({
      chat: finalChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: 'Final integration test',
      ownsGlobalStreaming: true,
    }).catch(() => {
      /* surfaced in chat history */
    }).finally(() => releaseLaunchSlot(finalChat.id));
  } catch (err) {
    releaseLaunchSlot(finalChat.id);
    throw err;
  }
}

/** Manual entry: run final integration test from board header. */
export async function startFinalIntegrationTestForPlannerChat(
  plannerChat: Chat,
): Promise<void> {
  const ctx = resolveBoardContext(plannerChat);
  if (!ctx) return;
  await startFinalIntegrationTest(ctx.group, ctx.planner);
}

function postPlannerBoardMessage(plannerChat: Chat, text: string): void {
  plannerChat.history.push({ role: 'assistant', content: text });
  touchChat(plannerChat);
  scheduleSaveSessions();
}

/** When every task is complete, start or surface the final integration test. */
export function tryTriggerFinalIntegrationTest(
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board || !isOrchestratePlanComplete(board)) return;
  if (board.finalTest?.status === 'passed') {
    void maybeEmitOrchestratePlanComplete(group.id);
    return;
  }
  if (board.finalTest?.status === 'in_progress') return;

  const attempts = board.finalTest?.attempts ?? 0;
  if (board.finalTest?.status === 'failed' && attempts >= MAX_FINAL_TEST_ATTEMPTS) {
    return;
  }

  if (isBoardAutoMode(group)) {
    void startFinalIntegrationTest(group, plannerChat);
    return;
  }

  board.finalTest = {
    ...(board.finalTest ?? {}),
    status: 'pending',
  };
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Reopen board tasks named by a failed final integration test (no builder start). */
export function applyFinalTestFailureReopens(
  group: ChatGroup,
  plannerChat: Chat,
  failingIds: string[],
  summary: string,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  for (const taskId of failingIds) {
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) continue;
    updateTask(group, taskId, { testAttempts: 1, testSummary: summary }, plannerChat);
    moveTaskStatus(group, taskId, 'in_progress', plannerChat);
  }
}

/** Route full-board Tester verdict after final integration chat ends. */
export function finalizeFinalTestOnStreamEnd(
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board?.finalTest) return;

  const verdict = board.finalTest.recordedVerdict;
  const summary = board.finalTest.summary?.trim() || 'Final integration test did not report a verdict';
  const failingIds = board.finalTest.failingTaskIds ?? [];

  if (verdict === 'pass') {
    board.finalTest = { ...board.finalTest, status: 'passed' };
    board.lastUpdatedAt = Date.now();
    scheduleSaveSessions();
    emitBoardChange(group.id);
    void maybeEmitOrchestratePlanComplete(group.id);
    return;
  }

  const attempts = (board.finalTest.attempts ?? 0) + 1;
  board.finalTest = {
    ...board.finalTest,
    status: 'failed',
    attempts,
    summary,
  };
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);

  if (attempts >= MAX_FINAL_TEST_ATTEMPTS) {
    postPlannerBoardMessage(
      plannerChat,
      [
        '**Final integration test exhausted**',
        '',
        summary,
        '',
        `${attempts}/${MAX_FINAL_TEST_ATTEMPTS} rounds completed. Review failing areas manually.`,
      ].join('\n'),
    );
    return;
  }

  if (!failingIds.length) {
    postPlannerBoardMessage(
      plannerChat,
      [
        '**Final integration test failed** (no failing task ids reported)',
        '',
        summary,
        '',
        'The Tester did not name responsible tasks — reopen tasks manually or re-run the final test.',
      ].join('\n'),
    );
    return;
  }

  applyFinalTestFailureReopens(group, plannerChat, failingIds, summary);

  for (const taskId of failingIds) {
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) continue;
    const seed = buildRetryBuilderSeedMessage(task, 1, `Final integration test: ${summary}`);
    updateTask(group, taskId, { pendingBuildSeed: seed }, plannerChat);
    void startTask(group, taskId, plannerChat).catch((err) =>
      reportBackgroundError('start-task-final-reopen', err),
    );
  }

  postPlannerBoardMessage(
    plannerChat,
    [
      '**Final integration test failed** — reopened task(s) for fix',
      '',
      `Tasks: ${failingIds.join(', ')}`,
      '',
      summary,
    ].join('\n'),
  );
}

/** Start task by planner chat (UI convenience). */
export async function startTaskForPlannerChat(
  plannerChat: Chat,
  taskId: string,
): Promise<void> {
  const ctx = resolveBoardContext(plannerChat);
  if (!ctx) return;
  await startTask(ctx.group, taskId, ctx.planner);
}

export async function stopTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const task = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.chatId) {
    stopTaskChatSupervision(task.chatId);
    stopGeneration(task.chatId);
  }
  if (task.testChatId) {
    stopTaskChatSupervision(task.testChatId);
    stopGeneration(task.testChatId);
  }
  await drainTaskQueue(group, plannerChat);
}

export function moveTaskStatus(
  group: ChatGroup,
  taskId: string,
  status: BoardTaskStatus,
  plannerChat?: Chat,
): void {
  const existing = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  const patch: Parameters<typeof updateTask>[2] = { status };
  if (status === 'planned' && existing?.error) {
    patch.error = undefined;
  }
  updateTask(group, taskId, patch, plannerChat);
  const board = group.orchestrateBoard;
  if (board && status === 'complete') {
    const planner = plannerChat ?? getPlannerChatForGroup(group);
    if (planner) tryTriggerFinalIntegrationTest(group, planner);
  }
  if (board && isBoardAutoMode(group) && plannerChat) {
    const reportable =
      status === 'complete' || status === 'failed' || status === 'blocked';
    if (reportable) {
      void import('../agents/controller/report.ts')
        .then((mod) => {
          const task = board.tasks.find((t) => t.id === taskId);
          if (!task) return;
          return mod.deliverOrchestratorTaskReport(group, plannerChat, task, status);
        })
        .catch((err) => reportBackgroundError('deliver-task-report', err));
    }
  }
}

/** Persist auto/manual/sequential execution mode. Does not start execution — use startBoardAutoRun. */
export function setBoardExecutionMode(
  group: ChatGroup,
  mode: 'manual' | 'auto' | 'sequential' | 'afk',
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.executionMode = mode;
  if (mode === 'manual') board.autoRunning = false;
  board.lastUpdatedAt = Date.now();
  // Flush stop state immediately so reload cannot resurrect auto execution.
  if (mode === 'manual') {
    saveSessionsNow();
  } else {
    scheduleSaveSessions();
  }
  emitBoardChange(group.id);
}

/** Set max concurrent tasks, clamped to [1,20]. Drains queue when in auto/sequential mode. */
export function setBoardMaxConcurrent(
  group: ChatGroup,
  value: number,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const clamped = Math.max(1, Math.min(20, Math.floor(value)));
  if (board.maxConcurrentTasks === clamped) return;
  board.maxConcurrentTasks = clamped;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
  if (isBoardAutoMode(group)) {
    void drainTaskQueue(group, plannerChat);
  }
}

/** True when a linked task chat still has an in-flight turn after reload. */
function shouldSuperviseBoardChatOnReload(chatId?: string): boolean {
  const id = chatId?.trim();
  if (!id) return false;
  const chat = findChatById(id);
  if (!chat) return false;
  return isTaskChatStreaming(id) || Boolean(chat.currentGenerationId?.trim());
}

/**
 * Re-subscribe stream handlers, re-attach heartbeat supervision, and resume
 * auto delegation after page reload (when autoRunning was persisted).
 */
export async function resumeBoardExecutionAfterReload(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  const board = group.orchestrateBoard;
  if (!board || !isBoardRunning(group)) return;

  await rehydrateBoardWorktreeRoots(group, plannerChat);

  const attachSupervision = (chatId?: string): void => {
    if (!shouldSuperviseBoardChatOnReload(chatId)) return;
    startTaskChatSupervision(chatId!.trim());
  };

  for (const task of board.tasks) {
    if (task.status === 'in_progress') {
      attachSupervision(task.chatId);
    } else if (task.status === 'testing') {
      attachSupervision(task.testChatId);
      attachSupervision(task.chatId);
    }
  }

  if (board.finalTest?.status === 'in_progress') {
    attachSupervision(board.finalTest.chatId);
  }

  await autoDelegateNext(group, plannerChat);
  emitBoardChange(group.id);
}

/** Begin auto/sequential execution — set running flag then kick off delegation. */
export function startBoardAutoRun(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board || !isBoardAutoMode(group)) return;
  board.autoRunning = true;
  // Clear any prior Stop so the timer resumes and the Stopped badge clears.
  board.userStopped = false;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
  void autoDelegateNext(group, plannerChat).catch((err) =>
    reportBackgroundError('auto-delegate-next', err),
  );
}

/** Stop all active task chats and clear the task queue. */
export function stopBoardAutoRun(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.autoRunning = false;
  // Freeze the header timer and surface the Stopped badge immediately, even if
  // task statuses lag behind the aborted streams (MIN-248).
  board.userStopped = true;
  board.lastUpdatedAt = Date.now();
  taskQueueByGroupId.delete(group.id);
  for (const task of board.tasks) {
    if (task.chatId) {
      stopTaskChatSupervision(task.chatId);
      stopGeneration(task.chatId);
    }
    if (task.testChatId) {
      stopTaskChatSupervision(task.testChatId);
      stopGeneration(task.testChatId);
    }
  }
  if (board.finalTest?.chatId) {
    stopTaskChatSupervision(board.finalTest.chatId);
    stopGeneration(board.finalTest.chatId);
  }
  stopGeneration(plannerChat.id);
  // Freeze the header timer now (close the open segment) instead of waiting for
  // the next live tick, so the elapsed value stops the instant Stop is pressed.
  syncOrchestrateBoardTimer(group, plannerChat, {
    isStreaming: false,
    activeRunCount: 0,
    userStopped: true,
  });
  // Cancel any sub-agent runs still attributed to the planner's active parent
  // turn so background runs/heartbeats do not linger after Stop (MIN-246).
  if (board.activeParentTurnId) {
    void import('../agents/controller/controller.ts')
      .then((mod) => mod.cancelAllForParentTurn(board.activeParentTurnId!))
      .catch((err) => reportBackgroundError('stop-board-cancel-runs', err));
  }
  // Flush stop state immediately so reload cannot resurrect auto execution.
  saveSessionsNow();
  emitBoardChange(group.id);
}

/** Pause every auto/sequential board on window close (mirrors pressing Stop). */
export function pauseAllRunningBoardsForShutdown(): void {
  const state = sessionState;
  if (!state?.groups?.length) return;
  for (const group of state.groups) {
    if (!isBoardRunning(group)) continue;
    const plannerId = group.plannerChatId?.trim();
    if (!plannerId) continue;
    const planner = state.chats.find((c) => c.id === plannerId);
    if (!planner) continue;
    stopBoardAutoRun(group, planner);
  }
}

/** Start all ready planned tasks up to the concurrency cap (auto-pilot / sequential). */
export async function autoDelegateNext(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  const board = group.orchestrateBoard;
  if (!board || !isBoardRunning(group)) return;

  const waveOrder = new Map(board.waves.map((w, i) => [String(w.id), i]));
  const ready = board.tasks
    .filter(
      (t) =>
        isTaskReadyForAuto(board, t) ||
        isTaskStalledForRestart(board, t, isTaskChatActive),
    )
    .sort((a, b) => {
      const wa = waveOrder.get(String(a.wave)) ?? 999;
      const wb = waveOrder.get(String(b.wave)) ?? 999;
      if (wa !== wb) return wa - wb;
      return board.tasks.indexOf(a) - board.tasks.indexOf(b);
    });
  for (const task of ready) {
    if (countRunningTaskChats(board) >= maxConcurrent(board)) {
      enqueueTask(group.id, task.id);
      continue;
    }
    await resumeBoardTask(group, task.id, plannerChat);
  }
  await drainTaskQueue(group, plannerChat);
}

function ensureAutoDriveSubscription(): void {
  if (autoDriveSubscribed) return;
  autoDriveSubscribed = true;
  void import('../agents/controller/report.ts').then((mod) => {
    mod.initOrchestratorAutoReports();
  });
}

/** Toggle kanban visibility for a wave section in board view. */
export function toggleWaveCollapsed(group: ChatGroup, waveId: number | string): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const wave = board.waves.find((w) => String(w.id) === String(waveId));
  if (!wave) return;
  wave.collapsed = !wave.collapsed;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Start all planned tasks in a wave up to the concurrency cap; queue the rest. */
export async function startWave(
  group: ChatGroup,
  waveId: number | string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const planned = board.tasks.filter(
    (t) => t.wave === waveId && t.status === 'planned',
  );
  for (const task of planned) {
    if (countRunningTaskChats(board) >= maxConcurrent(board)) {
      enqueueTask(group.id, task.id);
    } else {
      await startTask(group, task.id, plannerChat);
    }
  }
}

/** Ensure folder exists for a planner chat (legacy ensureBoardGroup). */
export function ensureBoardGroup(plannerChat: Chat): string {
  return getOrCreateBoardGroup(plannerChat).id;
}

/** Test hooks for launch-slot reservation and task-queue draining. */
export function reserveLaunchSlotForTests(chatId: string): void {
  reserveLaunchSlot(chatId);
}

export function releaseLaunchSlotForTests(chatId: string): void {
  releaseLaunchSlot(chatId);
}

export function enqueueTaskForTests(groupId: string, taskId: string): void {
  enqueueTask(groupId, taskId);
}

export function getTaskQueueForTests(groupId: string): string[] {
  return [...(taskQueueByGroupId.get(groupId) ?? [])];
}

export function clearTaskQueuesForTests(): void {
  taskQueueByGroupId.clear();
}

export async function drainTaskQueueForTests(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  return drainTaskQueue(group, plannerChat);
}
