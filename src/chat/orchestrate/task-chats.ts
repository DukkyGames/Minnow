/**
 * Related task chats for Kanban cards (primary chatId + folder/name discovery).
 */

import { findChatById } from '../../state/sessions';
import { isChatStreaming } from '../streaming-state';
import type { BoardTask, Chat, ChatGroup } from '../../types';

export interface TaskRelatedChat {
  chatId: string;
  title: string;
  streaming: boolean;
  isPrimary: boolean;
}

function taskNamePrefix(taskId: string): string {
  return `Task ${taskId}:`;
}

function chatBelongsToBoardGroup(chat: Chat, groupId: string): boolean {
  return chat.groupId === groupId || chat.boardGroupId === groupId;
}

/** List chats linked to a board task (primary first, deduped). */
export function listTaskRelatedChats(
  task: BoardTask,
  group: ChatGroup,
  allChats: readonly Chat[],
): TaskRelatedChat[] {
  const groupId = group.id;
  const seen = new Set<string>();
  const rows: TaskRelatedChat[] = [];
  const primaryId = task.chatId?.trim();

  const push = (chat: Chat, isPrimary: boolean): void => {
    if (seen.has(chat.id)) return;
    seen.add(chat.id);
    rows.push({
      chatId: chat.id,
      title: chat.name.trim() || 'Untitled chat',
      streaming: isChatStreaming(chat.id),
      isPrimary,
    });
  };

  if (primaryId) {
    const primary =
      allChats.find((c) => c.id === primaryId) ?? findChatById(primaryId);
    if (primary) push(primary, true);
  }

  const prefix = taskNamePrefix(task.id);
  for (const chat of allChats) {
    if (seen.has(chat.id)) continue;
    if (!chatBelongsToBoardGroup(chat, groupId)) continue;
    if (chat.boardTaskId === task.id) {
      push(chat, chat.id === primaryId);
      continue;
    }
    if (chat.name.startsWith(prefix)) {
      push(chat, chat.id === primaryId);
    }
  }

  rows.sort((a, b) => {
    if (a.isPrimary === b.isPrimary) return 0;
    return a.isPrimary ? -1 : 1;
  });

  return rows;
}
