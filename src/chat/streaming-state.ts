/**
 * Helpers for per-chat streaming: which chats are in-flight vs which chat is active in the UI.
 */

import { expertsPageOpen, streamingChatIds } from '../app-state';
import { getActiveChat } from '../state/sessions';
import { isOrchestratePlanScreenSuppressingChatDom } from '../ui/orchestrate-plan-screen';
import { isChatAppForeground } from '../ui/chat-mount';
import { isBoardViewActive } from '../ui/view-mode-toggle';
import { reportBackgroundError } from '../boot/report-background-error';

type ChatStreamEndListener = (chatId: string) => void;
const streamEndListeners = new Set<ChatStreamEndListener>();

/** Register for parent stream end (e.g. sub-agent completion flush). */
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

type ChatStreamActivityListener = (chatId: string) => void;
const streamActivityListeners = new Set<ChatStreamActivityListener>();

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

/**
 * Active chat id when it is streaming; otherwise any single streaming id; else null.
 * Sidebar "foreground" stream hint uses this.
 */
export function getStreamingChatId(): string | null {
  const active = getActiveChat();
  if (streamingChatIds.has(active.id)) return active.id;
  if (streamingChatIds.size === 1) return [...streamingChatIds][0]!;
  return null;
}

/** True when the given chat has an in-flight assistant turn. */
export function isChatStreaming(chatId: string): boolean {
  return streamingChatIds.has(chatId);
}

/** True when the active sidebar chat is the one currently streaming. */
export function isActiveChatStreaming(): boolean {
  return streamingChatIds.has(getActiveChat().id);
}

/** Concurrent streams are allowed — board cap handles orchestrate task limits. */
export function isBackgroundStreamBlockingSend(): boolean {
  return false;
}

/** Whether stream/tool DOM for this chat should mount in the active transcript (Code or Chat app). */
export function isStreamDomVisible(chatId: string): boolean {
  const active = getActiveChat();
  if (active.id !== chatId) return false;
  if (isOrchestratePlanScreenSuppressingChatDom(chatId)) return false;
  if (active.kind === 'expert-lab' && expertsPageOpen) return false;
  if (isChatAppForeground()) return true;
  if (isBoardViewActive()) return false;
  return true;
}
