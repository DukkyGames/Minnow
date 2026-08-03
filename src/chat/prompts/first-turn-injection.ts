/**
 * Gate Brain notes, code map, and workspace context documents to the first user turn only.
 */

import type { Chat } from '../../types';
import { isFirstUserMessagePending } from '../titles/schedule';

export interface FirstTurnInjectionOptions {
  /** Set from send path before pushing the user row (true = first message this chat). */
  firstUserSend?: boolean;
}

/** Whether first-turn-only injections should run for this compose pass. */
export function shouldRunFirstTurnInjections(
  chat: Chat,
  options?: FirstTurnInjectionOptions,
): boolean {
  if (options?.firstUserSend === true) return true;
  if (options?.firstUserSend === false) return false;
  return isFirstUserMessagePending(chat);
}
