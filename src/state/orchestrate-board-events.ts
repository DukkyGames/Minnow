/**
 * Pub/sub for Orchestrate board UI updates (decoupled from DOM).
 */

type BoardChangeListener = (chatId: string) => void;

const listenersByChatId = new Map<string, Set<BoardChangeListener>>();

/** Register a listener for one chat; returns unsubscribe. */
export function subscribeBoardChanges(
  chatId: string,
  listener: BoardChangeListener,
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

/** Notify subscribers that board state changed for a chat. */
export function emitBoardChange(chatId: string): void {
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
export function clearBoardListenersForTests(): void {
  listenersByChatId.clear();
}
