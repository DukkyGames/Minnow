/**
 * Session history helpers for outbound API replay and failed-turn recovery (MIN-184).
 */

import { hasPostToolTail } from '../tools/turn-continuation';
import { indexOfLastUserMessage, normalizeHistoryTail } from './history-truncate-core';
import type { Chat, Message } from '../types';

/** Clone session history and drop incomplete tool tails before API serialization. */
export function copyHistoryForOutboundApi(history: Message[]): Message[] {
  const copy = history.map((m) => ({ ...m }));
  normalizeHistoryTail(copy);
  return copy;
}

/**
 * Revert partial assistant/tool rows after a failed turn.
 * Keeps the user prompt at `forkHistoryIndex` and drops everything after it.
 */
export function rollbackFailedTurnHistory(chat: Chat, forkHistoryIndex: number): boolean {
  if (forkHistoryIndex < 0 || forkHistoryIndex >= chat.history.length) {
    return false;
  }
  const userRow = chat.history[forkHistoryIndex];
  if (userRow?.role !== 'user') {
    return false;
  }
  const keepThrough = forkHistoryIndex + 1;
  if (chat.history.length <= keepThrough) {
    return false;
  }
  chat.history = chat.history.slice(0, keepThrough);
  normalizeHistoryTail(chat.history);
  return true;
}

/** Drop orphan tool tails from persisted history (incomplete tool_call chains). */
export function repairSessionHistoryTail(chat: Chat): boolean {
  if (!hasPostToolTail(chat.history)) {
    return false;
  }
  const before = chat.history.length;
  normalizeHistoryTail(chat.history);
  return chat.history.length !== before;
}

/**
 * Before appending a new user message, remove a completed-but-unanswered tool tail
 * so reprompts do not replay poisoned history to the provider.
 */
export function clearPostToolTailBeforeSend(chat: Chat): boolean {
  if (!hasPostToolTail(chat.history)) {
    return false;
  }
  const lastUser = indexOfLastUserMessage(chat.history);
  if (lastUser < 0) {
    return false;
  }
  const keepThrough = lastUser + 1;
  if (chat.history.length <= keepThrough) {
    return false;
  }
  chat.history = chat.history.slice(0, keepThrough);
  normalizeHistoryTail(chat.history);
  return true;
}
