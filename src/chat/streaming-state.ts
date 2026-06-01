/**
 * Helpers for per-chat streaming: which chat owns the in-flight turn vs which chat is active in the UI.
 */

import { expertLabPageOpen, streaming, streamingChatId } from '../app-state';
import { normalizeModeId } from '../chat/modes/types';
import { getActiveChat, isExpertLabChat } from '../state/sessions';

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
    } catch {
      /* ignore */
    }
  }
}

/** Chat id driving the global streaming flag, or null when idle. */
export function getStreamingChatId(): string | null {
  if (!streaming) return null;
  return streamingChatId;
}

/** True when the given chat has an in-flight assistant turn. */
export function isChatStreaming(chatId: string): boolean {
  return streaming && streamingChatId === chatId;
}

/** True when the active sidebar chat is the one currently streaming. */
export function isActiveChatStreaming(): boolean {
  const id = getStreamingChatId();
  if (!id) return false;
  return getActiveChat().id === id;
}

/** True when a different chat is streaming and the active chat must not start a new turn. */
export function isBackgroundStreamBlockingSend(): boolean {
  const id = getStreamingChatId();
  if (!id) return false;
  return getActiveChat().id !== id;
}

/** Whether stream/tool DOM for this chat should mount in #chatArea (active chat, chat view). */
export function isStreamDomVisible(chatId: string): boolean {
  const active = getActiveChat();
  if (active.id !== chatId) return false;
  if (isExpertLabChat(active) && expertLabPageOpen) return false;
  const mode = normalizeModeId(active.modeId);
  if (mode === 'orchestrate' && active.viewMode === 'board') {
    return false;
  }
  return true;
}
