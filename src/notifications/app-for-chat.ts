/**
 * Resolve which MinnowOS app owns a chat session (Code vs Chat app).
 */

import { getCachedChatsWorkspacePath, isChatsWorkspacePath } from '../lib/chats-workspace';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { AppId } from '../os/types';
import type { Chat } from '../types';

/** True when a workspace path is the ~/.minnow/chats sandbox (cache-independent). */
function isChatsSandboxPath(workspacePath: string): boolean {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return false;
  return normalized.endsWith('/.minnow/chats');
}

/** Launcher app for a chat: Chat app when scoped to ~/.minnow/chats, else Code. */
export function appIdForChat(chat: Chat): AppId {
  const workspacePath = chat.workspacePath ?? '';
  const cachedChatsPath = getCachedChatsWorkspacePath();
  if (cachedChatsPath && isChatsWorkspacePath(workspacePath, cachedChatsPath)) {
    return 'chat';
  }
  if (isChatsSandboxPath(workspacePath)) {
    return 'chat';
  }
  return 'code';
}
