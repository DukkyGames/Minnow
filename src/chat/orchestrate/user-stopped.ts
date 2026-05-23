/**
 * Detect when the user explicitly stopped the orchestrate parent stream.
 */

import { hasIncompleteOrchestrateWork } from './plan-complete.ts';
import type { Chat } from '../../types.ts';

/**
 * True when the latest assistant turn was user-stopped and the board still has work.
 * Manual board Resume is allowed; supervisor auto-resume must not run.
 */
export function isUserStoppedChat(chat: Chat): boolean {
  const board = chat.orchestrateBoard;
  if (!board || !hasIncompleteOrchestrateWork(board)) {
    return false;
  }
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role === 'assistant') {
      return 'stopped' in msg && msg.stopped === true;
    }
    if (msg.role === 'user') {
      return false;
    }
  }
  return false;
}
