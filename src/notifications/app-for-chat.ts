/**
 * Resolve which Minnow app owns a chat session.
 */

import { isDeveloperReleased } from '../os/app-registry';
import type { AppId } from '../os/types';
import type { Chat } from '../types';

/**
 * Launcher app for a chat: Code (including Scratch), or Email when scoped.
 */
export function appIdForChat(chat: Chat): AppId {
  if (chat.appScope === 'email' && isDeveloperReleased('email')) {
    return 'email';
  }
  return 'code';
}
