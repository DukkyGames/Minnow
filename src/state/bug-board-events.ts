/**
 * Pub/sub for global bug tracker UI updates.
 */

type BugsChangeListener = () => void;

const listeners = new Set<BugsChangeListener>();

/** Register a global bugs listener; returns unsubscribe. */
export function subscribeBugsChanges(listener: BugsChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @deprecated Use subscribeBugsChanges — chatId is ignored. */
export function subscribeBugBoardChanges(
  _chatId: string,
  listener: BugsChangeListener,
): () => void {
  return subscribeBugsChanges(listener);
}

/** Notify subscribers that bug data changed. */
export function emitBugsChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** @deprecated Use emitBugsChange. */
export function emitBugBoardChange(_chatId: string): void {
  emitBugsChange();
}

/** Clear all listeners (test teardown). */
export function clearBugBoardListenersForTests(): void {
  listeners.clear();
}
