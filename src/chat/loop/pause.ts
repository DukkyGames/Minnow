import type { Chat } from '../../types';
import { getActiveLoops, touchActiveLoops, updateActiveLoop } from '../../state/sessions';

/** Freeze countdown until resume. */
export function pauseActiveLoop(chat: Chat, id: number, now = Date.now()): void {
  const loop = getActiveLoops(chat).find((row) => row.id === id);
  if (!loop || loop.paused) return;

  updateActiveLoop(chat, id, {
    paused: true,
    pausedRemainingMs: Math.max(0, loop.dueAt - now),
  });
}

/** Resume from frozen remaining time. */
export function resumeActiveLoop(chat: Chat, id: number, now = Date.now()): void {
  const loop = getActiveLoops(chat).find((row) => row.id === id);
  if (!loop || !loop.paused) return;

  const remaining = Math.max(0, loop.pausedRemainingMs ?? 0);
  const index = chat.activeLoops?.findIndex((row) => row.id === id) ?? -1;
  if (index < 0 || !chat.activeLoops) return;

  const next = {
    ...chat.activeLoops[index],
    paused: false,
    dueAt: now + remaining,
    id,
  };
  delete next.pausedRemainingMs;
  chat.activeLoops[index] = next;
  touchActiveLoops(chat);
}

/** True when the loop is paused and should not fire. */
export function isLoopPaused(loop: { paused?: boolean }): boolean {
  return loop.paused === true;
}
