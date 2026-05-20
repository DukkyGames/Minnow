import { chatFetchAbort } from '../app-state';

/** Abort the active chat completion fetch / SSE reader (no-op if idle). */
export function stopGeneration(): void {
  if (chatFetchAbort) chatFetchAbort.abort();
}
