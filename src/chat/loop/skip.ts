/**
 * Skip the wait until the next /loop fire.
 */

import type { Chat } from '../../types';
import { getActiveLoops, touchActiveLoops } from '../../state/sessions';

/** Mark a loop due now so the ticker fires on the next wake (unpauses if paused). */
export function skipActiveLoop(chat: Chat, id: number, now = Date.now()): void {
  const loop = getActiveLoops(chat).find((row) => row.id === id);
  if (!loop) return;

  const index = chat.activeLoops?.findIndex((row) => row.id === id) ?? -1;
  if (index < 0 || !chat.activeLoops) return;

  const next = {
    ...chat.activeLoops[index],
    dueAt: now,
    id,
  };
  if (loop.paused) {
    next.paused = false;
    delete next.pausedRemainingMs;
  }
  chat.activeLoops[index] = next;
  touchActiveLoops(chat);
}
