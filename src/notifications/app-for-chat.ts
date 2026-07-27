/**
 * Resolve which Minnow app owns a chat session.
 */

import {
  getCachedChatsWorkspacePath,
  isChatsWorkspacePath,
} from '../lib/chats-workspace';
import {
  getCachedDesktopWorkspacePath,
  isDesktopWorkspacePath,
} from '../lib/desktop-workspace';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { AppId } from '../os/types';
import type { Chat } from '../types';

/** True when a workspace path is the ~/.minnow/chats sandbox (cache-independent). */
function isChatsSandboxPath(workspacePath: string): boolean {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return false;
  return normalized.endsWith('/.minnow/chats');
}

/** True when a workspace path is the ~/.minnow/workspace sandbox (cache-independent). */
function isDesktopSandboxPath(workspacePath: string): boolean {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return false;
  return normalized.endsWith('/.minnow/workspace');
}

/**
 * Launcher app for a chat: desktop when scoped to ~/.minnow/workspace,
 * Chat app when scoped to ~/.minnow/chats, else Code.
 */
export function appIdForChat(chat: Chat): AppId {
  if (chat.appScope === 'email') {
    return 'email';
  }
  const workspacePath = chat.workspacePath ?? '';
  const cachedDesktopPath = getCachedDesktopWorkspacePath();
  if (cachedDesktopPath && isDesktopWorkspacePath(workspacePath, cachedDesktopPath)) {
    return 'chat';
  }
  if (isDesktopSandboxPath(workspacePath)) {
    return 'chat';
  }
  const cachedChatsPath = getCachedChatsWorkspacePath();
  if (cachedChatsPath && isChatsWorkspacePath(workspacePath, cachedChatsPath)) {
    return 'chat';
  }
  if (isChatsSandboxPath(workspacePath)) {
    return 'chat';
  }
  return 'code';
}
