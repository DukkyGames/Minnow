/**
 * Progress bus for eval suite runs (settings UI subscription).
 */

export interface EvalSuiteProgressEvent {
  suiteRunId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  completedCells: number;
  totalCells: number;
  currentTaskId: string | null;
  currentModelLabel: string | null;
  message?: string;
}

type Listener = (event: EvalSuiteProgressEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to suite progress; returns unsubscribe. */
export function subscribeEvalSuiteProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Emit progress to all subscribers. */
export function emitEvalSuiteProgress(event: EvalSuiteProgressEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {}
  }
}
