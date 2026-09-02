import type { ModeId } from './modes/types';
import type { Chat } from '../types';
import { isChatStreaming } from './streaming-state';
import { scheduleSaveSessions, touchChat } from '../state/sessions';
import { setChatMode, type SetChatModeResult } from '../ui/mode-selector';

/** Last-write-wins slot; applied when streaming ends for this chat. */
export function enqueuePendingMode(chat: Chat, modeId: ModeId): void {
  chat.pendingModeId = modeId;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Drop queued mode (explicit cancel only — normal stop still flushes). */
export function clearPendingMode(chat: Chat): void {
  if (!chat.pendingModeId) return;
  chat.pendingModeId = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

export function flushPendingMode(chat: Chat): SetChatModeResult | null {
  const modeId = chat.pendingModeId;
  if (!modeId) return null;
  if (isChatStreaming(chat.id)) return null;

  chat.pendingModeId = undefined;
  touchChat(chat);
  scheduleSaveSessions();
  return setChatMode(modeId);
}
