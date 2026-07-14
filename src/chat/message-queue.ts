/**
 * Composer message queue: hold follow-ups while a turn is streaming (MIN-200).
 * Push-now promotes an item to {@link pendingSteerMessage}; otherwise items drain after a normal turn end.
 */

import type { Chat, QueuedComposerMessage } from '../types';
import { randomUUID } from '../lib/random-id';
import {
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';
import { isChatTurnInProgress } from './chat-turn-guard';
import { enqueueSteerMessage } from './steer-message';

/** Return the chat queue array (empty when unset). */
export function getPendingMessageQueue(chat: Chat): QueuedComposerMessage[] {
  return Array.isArray(chat.pendingMessageQueue) ? chat.pendingMessageQueue : [];
}

/** Count of queued follow-ups for UI badges. */
export function getPendingMessageQueueCount(chat: Chat): number {
  return getPendingMessageQueue(chat).length;
}

function normalizeQueueItem(raw: unknown): QueuedComposerMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<QueuedComposerMessage>;
  const text = typeof row.text === 'string' ? row.text.trim() : '';
  if (!text) return null;
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : randomUUID();
  const createdAt =
    typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
      ? row.createdAt
      : Date.now();
  return { id, text, createdAt };
}

/** Validate persisted queue rows on session load. */
export function ensurePendingMessageQueue(
  raw: unknown,
): QueuedComposerMessage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw.map(normalizeQueueItem).filter(Boolean) as QueuedComposerMessage[];
  return items.length ? items : undefined;
}

/** Append a follow-up to the queue while the chat is streaming. */
export function enqueueComposerMessage(chat: Chat, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  forceCloseAskQuestionModal();
  const queue = getPendingMessageQueue(chat);
  if (!Array.isArray(chat.pendingMessageQueue)) {
    chat.pendingMessageQueue = queue;
  }
  chat.pendingMessageQueue!.push({
    id: randomUUID(),
    text: trimmed,
    createdAt: Date.now(),
  });
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}

/** Remove one queued follow-up by id. */
export function removeQueuedMessage(chat: Chat, id: string): boolean {
  const queue = getPendingMessageQueue(chat);
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) return false;
  queue.splice(index, 1);
  chat.pendingMessageQueue = queue.length > 0 ? queue : undefined;
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}

/** Update queued message text (edit in place). */
export function updateQueuedMessage(chat: Chat, id: string, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const queue = getPendingMessageQueue(chat);
  const item = queue.find((entry) => entry.id === id);
  if (!item) return false;
  item.text = trimmed;
  chat.pendingMessageQueue = queue;
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}

/** Promote a queued item to steer while streaming, or send immediately when idle. */
export function pushQueuedMessageNow(chat: Chat, id: string): boolean {
  const queue = getPendingMessageQueue(chat);
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const [item] = queue.splice(index, 1);
  chat.pendingMessageQueue = queue.length > 0 ? queue : undefined;
  touchChat(chat);
  scheduleSaveSessions();
  if (!item) return false;

  if (isChatTurnInProgress(chat.id)) {
    return enqueueSteerMessage(chat, item.text);
  }

  void import('../tools/loop').then(({ resumeParentChatWithMessage }) =>
    resumeParentChatWithMessage(chat, item.text),
  );
  return true;
}

/** Drop all queued follow-ups (e.g. chat delete). */
export function clearPendingMessageQueue(chat: Chat): void {
  if (!chat.pendingMessageQueue?.length) return;
  chat.pendingMessageQueue = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Send the oldest queued follow-up as a new turn after streaming ends. */
export async function flushPendingMessageQueue(chat: Chat): Promise<void> {
  const queue = getPendingMessageQueue(chat);
  if (queue.length === 0) return;
  const item = queue.shift();
  chat.pendingMessageQueue = queue.length > 0 ? queue : undefined;
  touchChat(chat);
  scheduleSaveSessions();
  if (!item?.text.trim()) return;

  const { resumeParentChatWithMessage } = await import('../tools/loop');
  await resumeParentChatWithMessage(chat, item.text);
}

/** @internal Test hook — append a queue row with a fixed id. */
export function enqueueComposerMessageForTests(
  chat: Chat,
  item: QueuedComposerMessage,
): void {
  if (!Array.isArray(chat.pendingMessageQueue)) {
    chat.pendingMessageQueue = [];
  }
  chat.pendingMessageQueue.push(item);
  touchChat(chat);
  scheduleSaveSessions();
}
