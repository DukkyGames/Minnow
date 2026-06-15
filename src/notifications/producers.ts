/**
 * Wire notification producers to board, sub-agent, and background job events.
 * Chat turn alerts are pushed from {@link notifyChatTurnEnded} in `loop.ts` after finalizeRun.
 */

import { isSubAgentRunTerminal } from '../agents/sub-agent-outcome';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { findGroupById } from '../state/chat-groups';
import { subscribeAllBoardChanges } from '../state/orchestrate-board-events';
import { findChatById, sessionState } from '../state/sessions';
import type { BoardTask, BoardTaskStatus } from '../types';
import { truncatePreview } from './preview';
import { pushNotification } from './push';

let initialized = false;

/** Previous board task status for transition detection. */
const taskStatusById = new Map<string, BoardTaskStatus>();
const notifiedSubAgentRuns = new Set<string>();

function chatTitle(chat: { name?: string }): string {
  return chat.name?.trim() || 'Chat';
}

function waveLabel(wave: BoardTask['wave']): string {
  return typeof wave === 'number' ? `Wave ${wave}` : String(wave);
}

function handleBoardChange(groupId: string): void {
  const group = findGroupById(groupId);
  const board = group?.orchestrateBoard;
  if (!board) return;

  const plannerChatId = group.plannerChatId;
  const defaultChatId = plannerChatId ?? undefined;

  for (const task of board.tasks) {
    const prev = taskStatusById.get(task.id);
    taskStatusById.set(task.id, task.status);

    if (prev === task.status) continue;

    const targetChatId = task.chatId?.trim() || defaultChatId;
    const title = task.title.trim() || task.id;
    const wave = waveLabel(task.wave);
    const dedupeBase = `task:${groupId}:${task.id}:${task.status}`;

    if (task.status === 'in_progress' && prev !== 'in_progress') {
      pushNotification({
        kind: 'task_started',
        title,
        preview: `${wave} — in progress`,
        chatId: targetChatId,
        appId: 'code',
        dedupeKey: dedupeBase,
      });
      continue;
    }

    if (task.status === 'complete' && prev !== 'complete') {
      pushNotification({
        kind: 'task_complete',
        title,
        preview: `${wave} — complete`,
        chatId: targetChatId,
        appId: 'code',
        dedupeKey: dedupeBase,
      });
      continue;
    }

    if (
      (task.status === 'failed' || task.status === 'blocked') &&
      prev !== task.status
    ) {
      const err = task.error?.trim() || task.status;
      pushNotification({
        kind: 'task_failed',
        title,
        preview: `${wave} — ${err}`,
        chatId: targetChatId,
        appId: 'code',
        dedupeKey: dedupeBase,
      });
    }
  }
}

function handleSubAgentRun(run: SubAgentRun): void {
  if (!isSubAgentRunTerminal(run.status)) return;
  if (notifiedSubAgentRuns.has(run.runId)) return;
  notifiedSubAgentRuns.add(run.runId);

  const parentChatId = run.parentChatId?.trim();
  const chat = parentChatId ? findChatById(parentChatId) : undefined;
  const title = chat ? chatTitle(chat) : 'Sub-agent';
  const dedupeKey = `subagent:${run.runId}`;

  if (run.status === 'completed') {
    const preview = truncatePreview(run.summary || 'Sub-agent completed');
    pushNotification({
      kind: 'sub_agent_complete',
      title,
      preview,
      chatId: parentChatId ?? undefined,
      appId: 'code',
      dedupeKey,
    });
    return;
  }

  const preview = truncatePreview(run.error || run.summary || `Sub-agent ${run.status}`);
  pushNotification({
    kind: 'sub_agent_failed',
    title,
    preview,
    chatId: parentChatId ?? undefined,
    appId: 'code',
    dedupeKey,
  });
}

/** Seed task status map so first poll does not fire spurious started events. */
function seedBoardTaskStatuses(): void {
  for (const group of sessionState?.groups ?? []) {
    for (const task of group.orchestrateBoard?.tasks ?? []) {
      taskStatusById.set(task.id, task.status);
    }
  }
}

/** Register notification event producers (call once from main.ts). */
export function initNotificationProducers(): void {
  if (initialized) return;
  initialized = true;

  seedBoardTaskStatuses();
  subscribeAllBoardChanges(handleBoardChange);
  subscribeSubAgentRuns(handleSubAgentRun);
}

/** Reset producer state (tests). */
export function resetNotificationProducersForTests(): void {
  initialized = false;
  taskStatusById.clear();
  notifiedSubAgentRuns.clear();
}

/** Exported for unit tests. */
export const __testHooks = {
  handleBoardChange,
  handleSubAgentRun,
};
