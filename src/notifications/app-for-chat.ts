/**
 * Resolve which MinnowOS app owns a chat session.
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { AppId } from '../os/types';
import type { Chat } from '../types';

/**
 * Launcher app for a chat, from its owning app scope.
 *
 * This used to compare `workspacePath` against the live Chat/Desktop workspace,
 * which mis-routed a notification whenever those folders were re-pointed (a Code
 * chat in a folder that later became the desktop workspace opened in Chat, and a
 * desktop chat stopped opening there at all).
 */
export function appIdForChat(chat: Chat): AppId {
  if (chat.appScope === 'email') return 'email';
  if (chat.appScope === 'chat' || chat.appScope === 'desktop') return 'chat';
  // Legacy rows written before `appScope`: fall back to the default sandbox paths.
  const normalized = normalizeWorkspacePath(chat.workspacePath ?? '');
  if (normalized.endsWith('/.minnow/chats') || normalized.endsWith('/.minnow/workspace')) {
    return 'chat';
  }
  return 'code';
}
