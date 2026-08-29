/**
 * Persist a "turn was interrupted" marker so the boot resume gate can prompt
 * after a graceful Quit (which cancels generations and clears currentGenerationId)
 * or a force-kill mid-tools when no generation id is on disk.
 */

import { isChatStreaming } from './streaming-state';
import { findIncompleteToolBatchAtTail } from './incomplete-tool-batch';
import {
  findChatById,
  flushPendingSessionSaveOnShutdown,
  sessionState,
  touchChat,
} from '../state/sessions';
import { setChatStopReason } from '../app-state';
import type { Chat } from '../types';

/** True when this chat should be offered in the boot resume prompt. */
export function isChatResumeInterrupted(chat: Chat): boolean {
  return chat.resumeInterrupted === true;
}

/** Mark a chat as mid-turn work that must survive quit / crash for the boot gate. */
export function markChatResumeInterrupted(chat: Chat): void {
  if (chat.resumeInterrupted === true) return;
  chat.resumeInterrupted = true;
  touchChat(chat);
}

/** Clear the interrupt marker (normal completion, user Stop, or gate decline/resume). */
export function clearChatResumeInterrupted(chat: Chat): void {
  if (chat.resumeInterrupted !== true) return;
  delete chat.resumeInterrupted;
  touchChat(chat);
}

/**
 * Whether this chat looks like in-flight work that quit must not silently drop.
 * Used by the shutdown preparer when deciding what to stamp.
 */
export function chatLooksInFlightForShutdown(chat: Chat): boolean {
  if (chat.resumeInterrupted === true) return true;
  if (chat.currentGenerationId?.trim()) return true;
  if (isChatStreaming(chat.id)) return true;
  // Lazy-unloaded histories cannot be scanned; generation id / streaming cover those.
  if (chat.historyLoaded === false) return false;
  return Boolean(findIncompleteToolBatchAtTail(chat));
}

/**
 * Before Electron tears down generations: stamp every in-flight chat, set stop
 * reason to `system` so AbortError teardown keeps the marker, and flush now.
 */
export function markInterruptedChatsForShutdown(): void {
  const state = sessionState;
  if (!state?.chats?.length) return;

  let any = false;
  for (const chat of state.chats) {
    if (!chatLooksInFlightForShutdown(chat)) continue;
    setChatStopReason(chat.id, 'system');
    markChatResumeInterrupted(chat);
    any = true;
  }
  if (!any) return;
  flushPendingSessionSaveOnShutdown();
}

/** Clear interrupt markers (and optional generation ids) for the listed chats. */
export function clearResumeInterruptedForChats(
  chats: readonly Chat[],
  options: { clearGenerationId?: boolean } = {},
): void {
  for (const chat of chats) {
    let dirty = false;
    if (chat.resumeInterrupted === true) {
      delete chat.resumeInterrupted;
      dirty = true;
    }
    if (options.clearGenerationId && chat.currentGenerationId != null) {
      delete chat.currentGenerationId;
      dirty = true;
    }
    if (dirty) touchChat(chat);
  }
}

/** Resolve a chat by id and clear its interrupt marker (chat-switch / stop helpers). */
export function clearResumeInterruptedById(chatId: string): void {
  const chat = findChatById(chatId);
  if (chat) clearChatResumeInterrupted(chat);
}
