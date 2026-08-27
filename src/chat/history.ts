/**
 * Session history helpers for outbound API replay and failed-turn recovery (MIN-184, MIN-666).
 */

import { hasPostToolTail } from '../tools/turn-continuation';
import { indexOfLastUserMessage, normalizeHistoryTail } from './history-truncate-core';
import type { AssistantMessage, Chat, Message } from '../types';

/** Clone session history and drop incomplete tool tails before API serialization. */
export function copyHistoryForOutboundApi(history: Message[]): Message[] {
  const copy = history.map((m) => ({ ...m }));
  normalizeHistoryTail(copy);
  return copy;
}

/**
 * True when the turn appended any assistant/tool row after the forked user message.
 */
export function turnProducedOutput(history: Message[], forkHistoryIndex: number): boolean {
  if (forkHistoryIndex < 0 || forkHistoryIndex >= history.length) {
    return false;
  }
  if (history[forkHistoryIndex]?.role !== 'user') {
    return false;
  }
  return history.length > forkHistoryIndex + 1;
}

/**
 * Coarse rewind used when a failed turn produced no assistant row:
 * keep the user prompt at `forkHistoryIndex` and drop everything after it.
 * User-facing Clear uses {@link clearFailedAssistantOutput} instead (MIN-666).
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

/** True when this row is the partial assistant output a failed turn left behind. */
function isFailedAssistantRow(row: Message | undefined): row is AssistantMessage {
  return row?.role === 'assistant' && (row as AssistantMessage).failed === true;
}

/**
 * First `failed: true` assistant after the fork user message, or -1.
 * Clear uses this so it can drop the failed reply without touching the prompt
 * or earlier successful turns (MIN-666).
 */
export function indexOfFailedAssistantAfter(
  history: Message[],
  forkHistoryIndex: number,
): number {
  if (forkHistoryIndex < 0 || forkHistoryIndex >= history.length) return -1;
  if (history[forkHistoryIndex]?.role !== 'user') return -1;
  for (let i = forkHistoryIndex + 1; i < history.length; i += 1) {
    if (isFailedAssistantRow(history[i])) return i;
  }
  return -1;
}

/**
 * Index of a tail `failed: true` assistant that still belongs to the current turn.
 * A later user message means the failure is no longer the live recovery target.
 */
export function indexOfLastFailedAssistantAtTail(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === 'user') return -1;
    if (isFailedAssistantRow(row)) return i;
  }
  return -1;
}

/**
 * Drop only the failed assistant output after `forkHistoryIndex`.
 * Keeps the user prompt, earlier successful turns, and completed tool rows
 * that landed before the failure. Does not resend.
 */
export function clearFailedAssistantOutput(
  chat: Chat,
  forkHistoryIndex: number,
): boolean {
  const failedAt = indexOfFailedAssistantAfter(chat.history, forkHistoryIndex);
  if (failedAt < 0) return false;
  chat.history = chat.history.slice(0, failedAt);
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
