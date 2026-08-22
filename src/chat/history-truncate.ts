/**
 * Chat history truncation with atomic assistant + tool_call chains.
 */

import { isChatStreaming } from '../chat/streaming-state';
import {
  findChatById,
  getActiveChat,
  isChatHistoryLoaded,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { pruneSupersededRunsAfterTruncate } from '../state/runs-store';
import type { Chat } from '../types';
import {
  expandAtomicRange,
  indexOfLastUserMessage,
  indexOfUserBeforeBlock,
  normalizeHistoryTail,
  sliceHistoryAtTurn,
  findToolResultRange,
} from './history-truncate-core';

export type TruncateMode = 'inclusive' | 'exclusive';

export interface TruncateResult {
  ok: boolean;
  error?:
    | 'not_found'
    | 'streaming'
    | 'invalid_index'
    | 'invalid_target'
    | 'history_not_loaded';
  removedCount?: number;
  chat?: Chat;
}

export {
  expandAtomicRange,
  findToolResultRange,
  indexOfLastUserMessage,
  indexOfUserBeforeBlock,
  normalizeHistoryTail,
  sliceHistoryAtTurn,
};

/**
 * Truncate chat history at a logical turn boundary.
 * Inclusive keeps through the target block; exclusive removes the block and after.
 */
export function truncateChatHistory(
  chatId: string,
  cutIndex: number,
  mode: TruncateMode,
): TruncateResult {
  if (isChatStreaming(chatId)) {
    return { ok: false, error: 'streaming' };
  }

  const chat =
    findChatById(chatId) ??
    (getActiveChat().id === chatId ? getActiveChat() : undefined);
  if (!chat) {
    return { ok: false, error: 'not_found' };
  }

  /*
   * `cutIndex` is absolute into the full transcript. An unhydrated chat holds an
   * empty placeholder, so slicing it would persist that placeholder as the whole
   * history. Callers must `await ensureChatHistoryLoaded` first.
   */
  if (!isChatHistoryLoaded(chat)) {
    return { ok: false, error: 'history_not_loaded' };
  }

  if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= chat.history.length) {
    return { ok: false, error: 'invalid_index' };
  }

  const row = chat.history[cutIndex];
  if (row.role === 'tool') {
    const { start } = expandAtomicRange(chat.history, cutIndex);
    if (start < 0 || chat.history[start]?.role !== 'assistant') {
      return { ok: false, error: 'invalid_target' };
    }
  }

  const beforeLen = chat.history.length;
  chat.history = sliceHistoryAtTurn(chat.history, cutIndex, mode);
  const removedCount = beforeLen - chat.history.length;

  const keptThrough =
    mode === 'inclusive' ? cutIndex : Math.max(0, cutIndex - 1);
  pruneSupersededRunsAfterTruncate(chat, keptThrough);

  touchChat(chat);
  scheduleSaveSessions();

  return { ok: true, removedCount, chat };
}

/** Replace user row content after an inclusive truncate at the same index. */
export function updateUserMessageAt(
  chatId: string,
  userIndex: number,
  newContent: string,
): boolean {
  const truncated = truncateChatHistory(chatId, userIndex, 'inclusive');
  if (!truncated.ok || !truncated.chat) return false;

  const chat = truncated.chat;
  if (userIndex < 0 || userIndex >= chat.history.length) return false;
  const row = chat.history[userIndex];
  if (row.role !== 'user') return false;

  row.content = newContent;
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}
