/**
 * Pub/sub for Issues app UI updates (MIN-261).
 */

type IssuesChangeListener = () => void;

const listeners = new Set<IssuesChangeListener>();

/** Register an issues change listener; returns unsubscribe. */
export function subscribeIssuesChanges(listener: IssuesChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify subscribers that issue data changed. */
export function emitIssuesChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {}
  }
}

/** Clear all listeners (test teardown). */
export function clearIssuesListenersForTests(): void {
  listeners.clear();
}
