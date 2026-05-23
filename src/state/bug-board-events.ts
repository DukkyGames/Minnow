/**
 * Pub/sub for bug board UI updates (decoupled from DOM).
 */

type BugBoardChangeListener = (chatId: string) => void;

const listenersByChatId = new Map<string, Set<BugBoardChangeListener>>();

/** Register a listener for one chat; returns unsubscribe. */
export function subscribeBugBoardChanges(
  chatId: string,
  listener: BugBoardChangeListener,
): () => void {
  let set = listenersByChatId.get(chatId);
  if (!set) {
    set = new Set();
    listenersByChatId.set(chatId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listenersByChatId.delete(chatId);
  };
}

/** Notify subscribers that bug board state changed for a chat. */
export function emitBugBoardChange(chatId: string): void {
  const set = listenersByChatId.get(chatId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(chatId);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Clear all listeners (test teardown). */
export function clearBugBoardListenersForTests(): void {
  listenersByChatId.clear();
}
