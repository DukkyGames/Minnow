/**
 * Pub/sub for Orchestrate board UI updates (decoupled from DOM).
 * Listeners are keyed by sidebar folder id ({@link ChatGroup.id}).
 */

import { reportBackgroundError } from '../boot/report-background-error.ts';

type BoardChangeListener = (groupId: string) => void;

const listenersByGroupId = new Map<string, Set<BoardChangeListener>>();
const globalListeners = new Set<BoardChangeListener>();

/** Register a listener for one board folder; returns unsubscribe. */
export function subscribeBoardChanges(
  groupId: string,
  listener: BoardChangeListener,
): () => void {
  let set = listenersByGroupId.get(groupId);
  if (!set) {
    set = new Set();
    listenersByGroupId.set(groupId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listenersByGroupId.delete(groupId);
  };
}

/** Register a listener for any board folder change; returns unsubscribe. */
export function subscribeAllBoardChanges(listener: BoardChangeListener): () => void {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
}

/** Notify subscribers that board state changed for a folder. */
export function emitBoardChange(groupId: string): void {
  for (const fn of globalListeners) {
    try {
      fn(groupId);
    } catch (err) {
      reportBackgroundError('board-change-listener', err);
    }
  }
  const set = listenersByGroupId.get(groupId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(groupId);
    } catch (err) {
      reportBackgroundError('board-change-listener', err);
    }
  }
}

/** Clear all listeners (test teardown). */
export function clearBoardListenersForTests(): void {
  listenersByGroupId.clear();
  globalListeners.clear();
}
