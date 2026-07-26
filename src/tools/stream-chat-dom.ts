/**
 * Remount in-flight stream rows when the user returns to a chat that is still streaming.
 */

import { isChatStreaming, isStreamDomVisible } from '../chat/streaming-state';
import { getSidebarStreamPhase } from '../ui/chat-item-dot';
import type { StreamingAssistantRow } from '../ui/messages';
import { appendStreamingAssistantRow } from '../ui/messages';
import type { StreamingStatusHandle } from '../ui/stream-status';
import type { ThoughtBubbleController } from '../ui/thought-bubbles';

export interface StreamDomHandles {
  wrap: HTMLDivElement;
  bubble: HTMLDivElement;
  cursor: HTMLDivElement;
  streamStatus: StreamingStatusHandle;
}

type RemountListener = (row: StreamDomHandles) => void;

const remountListeners = new Map<string, RemountListener>();

/** Loop registers while a turn runs; cleared in finally. */
export function registerStreamDomRemount(
  chatId: string,
  listener: RemountListener | null,
): void {
  if (listener) {
    remountListeners.set(chatId, listener);
  } else {
    remountListeners.delete(chatId);
  }
}

/**
 * After switchChat / history paint, attach a fresh stream shell if this chat is
 * still in-flight. Engine mirrors register a remount listener without joining
 * `streamingChatIds` (so remote session reconcile is not blocked).
 */
export function remountStreamDomForChat(chatId: string): void {
  if (!isStreamDomVisible(chatId)) return;

  const listener = remountListeners.get(chatId);
  // Renderer tool loop: streamingChatIds. Engine path: remount listener only.
  if (!isChatStreaming(chatId) && !listener) return;

  const row: StreamingAssistantRow = appendStreamingAssistantRow(chatId);

  // Restore phase before the listener so thought-bubble remount can hide status again.
  const phase = getSidebarStreamPhase(chatId);
  if (phase === 'thinking') {
    row.streamStatus.setPhase('thinking');
  } else if (phase === 'generating') {
    row.streamStatus.setPhase('generating');
  }

  if (listener) {
    listener({
      wrap: row.wrap,
      bubble: row.bubble,
      cursor: row.cursor,
      streamStatus: row.streamStatus,
    });
  }
}
