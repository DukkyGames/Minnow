/**
 * Resolve which Minnow app owns a chat session.
 */

import type { AppId } from '../os/types';
import type { Chat } from '../types';

/** Launcher app for a chat: Code (including Scratch). */
export function appIdForChat(_chat: Chat): AppId {
  return 'code';
}
