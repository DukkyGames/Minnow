/**
 * Lightweight pub/sub so the chat UI can react to sub-agent lifecycle updates
 * without coupling the orchestrator to DOM code.
 */

import type { SubAgentRun } from './types';

type SubAgentRunListener = (run: SubAgentRun) => void;

const listeners = new Set<SubAgentRunListener>();

/** Register a listener; returns an unsubscribe function. */
export function subscribeSubAgentRuns(listener: SubAgentRunListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify all subscribers (synchronous; keep work minimal). */
export function emitSubAgentRunUpdated(run: SubAgentRun): void {
  for (const fn of listeners) {
    try {
      fn(run);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Clear listeners (e.g. test teardown). */
export function clearSubAgentRunListeners(): void {
  listeners.clear();
}
