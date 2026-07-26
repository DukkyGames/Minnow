/**
 * Pub/sub for Issues taxonomy catalog updates.
 */

type IssuesTaxonomyChangeListener = () => void;

const listeners = new Set<IssuesTaxonomyChangeListener>();

/** Register a taxonomy change listener; returns unsubscribe. */
export function subscribeIssuesTaxonomyChanges(
  listener: IssuesTaxonomyChangeListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify subscribers that the taxonomy catalog changed. */
export function emitIssuesTaxonomyChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Clear all listeners (test teardown). */
export function clearIssuesTaxonomyListenersForTests(): void {
  listeners.clear();
}
