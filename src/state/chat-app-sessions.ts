/**
 * Minnow Chat app session helpers (client; uses sessions API + chats workspace path).
 */

import { getChatsWorkspacePath, isChatsWorkspacePath } from '../lib/chats-workspace';
import type { Chat } from '../types';
import {
  CHAT_APP_ID,
  createAssistantChat,
  isAssistantChat as isAssistantChatForPath,
} from './session-workspace-scope';

export { CHAT_APP_ID, createAssistantChat };

/** True when the chat is scoped to the chats workspace sandbox. */
export function isAssistantChat(chat: Chat, chatsWorkspacePath: string): boolean {
  return isAssistantChatForPath(chat, chatsWorkspacePath);
}

/** True when the chat workspace path matches the cached or provided chats sandbox path. */
export function isAssistantChatWorkspace(
  chat: Chat,
  chatsWorkspacePath?: string | null,
): boolean {
  return isChatsWorkspacePath(chat.workspacePath ?? '', chatsWorkspacePath);
}

/**
 * Ensure an active assistant chat exists for the Chat app and make it the session active chat.
 * Fetches the chats workspace path from the server when needed.
 */
export async function ensureActiveAssistantChat(): Promise<Chat> {
  const chatsWorkspacePath = await getChatsWorkspacePath();
  if (!chatsWorkspacePath) {
    throw new Error('Chats workspace is unavailable (start the tool server with npm start)');
  }
  const { activateAssistantChatForApp } = await import('./sessions');
  return activateAssistantChatForApp(chatsWorkspacePath);
}
