/**
 * In-process chat stream-end / activity bus for the Session Engine (MIN-360 Phase 2).
 *
 * Co-locates the former DOM-adjacent bus from streaming-state.ts so the main-chat
 * loop and orchestrate board scheduler can subscribe without a renderer round-trip.
 * The client streaming-state module re-exports these helpers for UI listeners.
 */

import { reportBackgroundError } from '../boot/report-background-error.ts';

type ChatStreamEndListener = (chatId: string) => void;
const streamEndListeners = new Set<ChatStreamEndListener>();

type ChatStreamActivityListener = (chatId: string) => void;
const streamActivityListeners = new Set<ChatStreamActivityListener>();

/** Register for parent stream end (e.g. board finalize / drain). */
export function subscribeChatStreamEnd(listener: ChatStreamEndListener): () => void {
  streamEndListeners.add(listener);
  return () => {
    streamEndListeners.delete(listener);
  };
}

/** Notify subscribers that a chat finished streaming (call before clearing streaming flags). */
export function notifyChatStreamEnded(chatId: string): void {
  if (!chatId) return;
  for (const fn of streamEndListeners) {
    try {
      fn(chatId);
    } catch (err) {
      reportBackgroundError('stream-end-listener', err);
    }
  }
}

/** Register for streaming deltas (prose, reasoning, tools) on any chat. */
export function subscribeChatStreamActivity(
  listener: ChatStreamActivityListener,
): () => void {
  streamActivityListeners.add(listener);
  return () => {
    streamActivityListeners.delete(listener);
  };
}

/** Notify subscribers that a chat received stream/progress activity. */
export function notifyChatStreamActivity(chatId: string): void {
  if (!chatId) return;
  for (const fn of streamActivityListeners) {
    try {
      fn(chatId);
    } catch (err) {
      reportBackgroundError('stream-activity-listener', err);
    }
  }
}

/** Clear listeners between tests. */
export function resetStreamBusForTests(): void {
  streamEndListeners.clear();
  streamActivityListeners.clear();
}
