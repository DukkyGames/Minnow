/**
 * Prevents overlapping chat turn setup for the same session (double-send before streaming flag is set).
 */

import { isChatStreaming } from './streaming-state';

const chatTurnSetupPending = new Set<string>();

/** True while this chat is preparing or running a turn (before or during global streaming). */
export function isChatTurnSetupPending(chatId: string): boolean {
  return chatTurnSetupPending.has(chatId);
}

/**
 * Claim setup for a chat turn. Returns false when the chat is already busy.
 */
export function beginChatTurnSetup(chatId: string): boolean {
  if (isChatStreaming(chatId)) {
    return false;
  }
  if (chatTurnSetupPending.has(chatId)) {
    return false;
  }
  chatTurnSetupPending.add(chatId);
  return true;
}

/** Release setup claim after runChatTurn finishes or aborts early. */
export function endChatTurnSetup(chatId: string): void {
  chatTurnSetupPending.delete(chatId);
}
