/**
 * Dismiss per-chat alerts when the user opens or focuses a chat thread.
 */

import { recordChatOpened } from '../ui/chat-item-dot';
import { sessionState } from '../state/sessions';
import { markNotificationsReadForChat } from './store';

/** Clear sidebar unread/error flags and menubar inbox rows for this chat. */
export function acknowledgeChatViewed(chatId: string): void {
  const trimmed = chatId.trim();
  if (!trimmed) return;
  const chat = sessionState?.chats.find((c) => c.id === trimmed);
  if (chat) {
    chat.unread = false;
    chat.turnError = false;
  }
  recordChatOpened(trimmed);
  markNotificationsReadForChat(trimmed);
}
