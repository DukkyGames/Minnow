/**
 * Manual orchestrate board operations — shared by UI buttons and LLM tools.
 */

import { resolveSubAgentModelBinding } from '../agents/resolve-sub-agent-binding.ts';
import { loadSubAgentConfig } from '../agents/sub-agent-config.ts';
import { stopGeneration } from '../chat/stop-generation.ts';
import { maybeEmitOrchestratePlanComplete } from '../chat/orchestrate/plan-complete-ui.ts';
import { isChatStreaming, subscribeChatStreamEnd } from '../chat/streaming-state.ts';
import { runChatTurn } from '../tools/loop.ts';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup } from '../types.ts';
import {
  assignChatToGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { updateTask } from './orchestrate-board-store.ts';
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

function ensureStreamEndSubscription(): void {
  if (streamEndSubscribed) return;
  streamEndSubscribed = true;
  subscribeChatStreamEnd((endedChatId) => {
    if (!sessionState) return;
    for (const group of sessionState.groups ?? []) {
      const board = group.orchestrateBoard;
      if (!board) continue;
      const task = board.tasks.find((t) => t.chatId === endedChatId);
      if (!task) continue;
      const planner = getPlannerChatForGroup(group);
      if (planner) void drainTaskQueue(group, planner);
    }
  });
}

function maxConcurrent(board: NonNullable<ChatGroup['orchestrateBoard']>): number {
  const n = board.maxConcurrentTasks;
  return typeof n === 'number' && n > 0 ? n : DEFAULT_MAX_CONCURRENT;
}

/** Running task chats = linked chatId with active stream. */
export function countRunningTaskChats(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  let n = 0;
  for (const task of board.tasks) {
    const id = task.chatId?.trim();
    if (id && isChatStreaming(id)) n += 1;
  }
  return n;
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

export function assignAgent(
  group: ChatGroup,
  taskId: string,
  agentType: string,
  plannerChat?: Chat,
): void {
  updateTask(group, taskId, { agentType: agentType.trim() }, plannerChat);
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

  const agentType = task.agentType?.trim() || 'generalPurpose';
  if (!task.agentType) {
    updateTask(group, taskId, { agentType }, plannerChat);
  }

  if (countRunningTaskChats(board) >= maxConcurrent(board)) {
    enqueueTask(group.id, taskId);
    return;
  }

  const config = await loadSubAgentConfig();
  const typeConfig = config.types[agentType];
  const binding = resolveSubAgentModelBinding(
    {
      providerId: typeConfig?.providerId ?? plannerChat.providerId ?? '',
      modelId: typeConfig?.modelId ?? plannerChat.modelId ?? '',
    },
    plannerChat,
  );

  const folderId = group.id;

  let taskChat: Chat;
  const existingId = task.chatId?.trim();
  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) {
      taskChat = existing;
    } else {
      taskChat = createEmptyChatObject(binding.modelId, plannerChat.workspacePath);
      taskChat.providerId = binding.providerId;
      taskChat.modeId = 'build';
      taskChat.workAgentId = typeConfig?.workAgentId ?? null;
      taskChat.name = `Task ${task.id}: ${task.title}`;
      taskChat.groupId = folderId;
      taskChat.boardGroupId = folderId;
      requireSession().chats.unshift(taskChat);
      updateTask(group, taskId, { chatId: taskChat.id }, plannerChat);
    }
  } else {
    taskChat = createEmptyChatObject(binding.modelId, plannerChat.workspacePath);
    taskChat.providerId = binding.providerId;
    taskChat.modeId = 'build';
    taskChat.workAgentId = typeConfig?.workAgentId ?? null;
    taskChat.name = `Task ${task.id}: ${task.title}`;
    taskChat.groupId = folderId;
    taskChat.boardGroupId = folderId;
    requireSession().chats.unshift(taskChat);
    updateTask(group, taskId, { chatId: taskChat.id }, plannerChat);
    assignChatToGroup(taskChat.id, folderId);
  }

  const { renderSidebar } = await import('../ui/sidebar.ts');
  renderSidebar();

  const seed = buildTaskSeedMessage(group, plannerChat, task);
  const startPatch: Parameters<typeof updateTask>[2] = {
    status: 'in_progress',
    startedAt: Date.now(),
  };
  if (task.error) {
    startPatch.error = undefined;
  }
  updateTask(group, taskId, startPatch, plannerChat);

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
