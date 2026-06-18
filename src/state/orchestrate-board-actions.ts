/**
 * Manual orchestrate board operations — shared by UI buttons and LLM tools.
 */

import { stopGeneration } from '../chat/stop-generation.ts';
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
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup, OrchestrateBoardState } from '../types.ts';
import {
  assignChatToGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { isTaskReadyForAuto, isTaskStalledForRestart, isBoardAutoMode, getBoardExecutionMode, updateTask } from './orchestrate-board-store.ts';

export { getBoardExecutionMode, isBoardAutoMode };
import {
  createEmptyChatObject,
  findChatById,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from './sessions.ts';

function requireSession(): NonNullable<typeof sessionState> {
  if (!sessionState) throw new Error('Session not loaded');
  return sessionState;
}

const DEFAULT_MAX_CONCURRENT = 3;

/** Per-board folder id → queued task ids waiting for a concurrency slot. */
const taskQueueByGroupId = new Map<string, string[]>();

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
 * Advance board task status when its linked chat finishes streaming.
 * Auto-pilot marks successful runs complete; manual mode moves to testing for review.
 */
export function finalizeBoardTaskOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): void {
  if (task.status !== 'in_progress' && task.status !== 'testing') return;

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

  const nextStatus: BoardTaskStatus = isBoardAutoMode(group) ? 'complete' : 'testing';
  updateTask(group, task.id, { endedAt: Date.now(), error: undefined }, plannerChat);
  moveTaskStatus(group, task.id, nextStatus, plannerChat);
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

function ensureStreamEndSubscription(): void {
  if (!streamEndSubscribed) {
    streamEndSubscribed = true;
    subscribeChatStreamEnd((endedChatId) => {
      stopTaskChatSupervision(endedChatId);
      if (!sessionState) return;
      for (const group of sessionState.groups ?? []) {
        const board = group.orchestrateBoard;
        if (!board) continue;
        const task = board.tasks.find((t) => t.chatId === endedChatId);
        if (!task) continue;
        const planner = getPlannerChatForGroup(group);
        if (!planner) continue;
        finalizeBoardTaskOnStreamEnd(group, task, planner);
        void drainTaskQueue(group, planner);
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
  const n = board.maxConcurrentTasks;
  return typeof n === 'number' && n > 0 ? n : DEFAULT_MAX_CONCURRENT;
}

/** Running task chats = linked chatId with active stream or turn setup in flight. */
export function countRunningTaskChats(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  let n = 0;
  for (const task of board.tasks) {
    const id = task.chatId?.trim();
    if (!id) continue;
    if (isChatStreaming(id) || isChatTurnSetupPending(id)) n += 1;
  }
  return n;
}

/** True when a task chat is starting or streaming (occupies a concurrency slot). */
export function isTaskChatActive(chatId: string): boolean {
  return isChatStreaming(chatId) || isChatTurnSetupPending(chatId);
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

async function drainTaskQueue(group: ChatGroup, plannerChat: Chat): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const queue = taskQueueByGroupId.get(group.id);
  if (!queue?.length) return;
  while (queue.length > 0 && countRunningTaskChats(board) < maxConcurrent(board)) {
    const nextId = queue.shift()!;
    await startTask(group, nextId, plannerChat);
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

/** Start a linked task chat (background stream; does not switch active chat). */
export async function startTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
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

  const providerId = plannerChat.providerId ?? '';
  const modelId = plannerChat.modelId ?? '';
  const folderId = group.id;

  let taskChat: Chat;
  const existingId = task.chatId?.trim();
  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) {
      taskChat = existing;
      taskChat.boardTaskId = task.id;
    } else {
      taskChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
      taskChat.providerId = providerId;
      taskChat.modeId = 'build';
      taskChat.workAgentId = null;
      taskChat.name = `Task ${task.id}: ${task.title}`;
      taskChat.groupId = folderId;
      taskChat.boardGroupId = folderId;
      taskChat.boardTaskId = task.id;
      requireSession().chats.unshift(taskChat);
      updateTask(group, taskId, { chatId: taskChat.id }, plannerChat);
    }
  } else {
    taskChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
    taskChat.providerId = providerId;
    taskChat.modeId = 'build';
    taskChat.workAgentId = null;
    taskChat.name = `Task ${task.id}: ${task.title}`;
    taskChat.groupId = folderId;
    taskChat.boardGroupId = folderId;
    taskChat.boardTaskId = task.id;
    requireSession().chats.unshift(taskChat);
    updateTask(group, taskId, { chatId: taskChat.id }, plannerChat);
    assignChatToGroup(taskChat.id, folderId);
  }

  const { renderSidebar } = await import('../ui/sidebar.ts');
  renderSidebar();

  const seed = buildTaskSeedMessage(group, plannerChat, task);

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
  }).catch(() => {
    /* surfaced in chat history */
  });
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
  if (!task?.chatId) return;
  stopTaskChatSupervision(task.chatId);
  stopGeneration(task.chatId);
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
    void maybeEmitOrchestratePlanComplete(group.id);
  }
  if (board && isBoardAutoMode(group) && plannerChat) {
    const reportable =
      status === 'complete' || status === 'failed' || status === 'blocked';
    if (reportable) {
      void import('../agents/controller/report.ts').then((mod) => {
        const task = board.tasks.find((t) => t.id === taskId);
        if (!task) return;
        void mod.deliverOrchestratorTaskReport(group, plannerChat, task, status);
      });
    }
  }
}

/** Persist auto/manual execution mode and kick off delegation when enabling auto. */
export function setBoardExecutionMode(
  group: ChatGroup,
  mode: 'manual' | 'auto',
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.executionMode = mode;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
  if (mode === 'auto') {
    void autoDelegateNext(group, plannerChat);
  }
}

/** Start all ready planned tasks up to the concurrency cap (auto-pilot). */
export async function autoDelegateNext(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  const board = group.orchestrateBoard;
  if (!board || !isBoardAutoMode(group)) return;

  const ready = board.tasks.filter(
    (t) =>
      isTaskReadyForAuto(board, t) ||
      isTaskStalledForRestart(board, t, isTaskChatActive),
  );
  for (const task of ready) {
    if (countRunningTaskChats(board) >= maxConcurrent(board)) {
      enqueueTask(group.id, task.id);
      continue;
    }
    await startTask(group, task.id, plannerChat);
  }
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
