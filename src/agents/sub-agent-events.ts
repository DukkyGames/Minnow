import type { SubAgentRun } from './types';

type SubAgentRunListener = (run: SubAgentRun) => void;

const listeners = new Set<SubAgentRunListener>();

export function subscribeSubAgentRuns(listener: SubAgentRunListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSubAgentRunUpdated(run: SubAgentRun): void {
  for (const fn of listeners) {
    try {
      fn(run);
    } catch {}
  }
}

export function clearSubAgentRunListeners(): void {
  listeners.clear();
}
