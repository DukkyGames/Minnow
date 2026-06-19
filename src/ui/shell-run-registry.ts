/**
 * Tracks in-flight agent shell runs (blocking SSE + background) for kill UI.
 */

export interface ShellRunEntry {
  runId: string;
  command: string;
  toolCallId?: string;
  chatId?: string;
}

type ShellRunListener = () => void;

const activeByRunId = new Map<string, ShellRunEntry>();
const runIdByToolCallId = new Map<string, string>();
const listeners = new Set<ShellRunListener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Register a shell run that can be stopped from the console or tool-call UI. */
export function registerShellRun(entry: ShellRunEntry): void {
  activeByRunId.set(entry.runId, entry);
  if (entry.toolCallId) {
    runIdByToolCallId.set(entry.toolCallId, entry.runId);
  }
  notify();
}

/** Remove a shell run after it finishes or is cancelled. */
export function unregisterShellRun(runId: string): void {
  const entry = activeByRunId.get(runId);
  if (entry?.toolCallId) {
    runIdByToolCallId.delete(entry.toolCallId);
  }
  activeByRunId.delete(runId);
  notify();
}

export function getShellRun(runId: string): ShellRunEntry | undefined {
  return activeByRunId.get(runId);
}

export function getShellRunIdForToolCall(toolCallId: string): string | undefined {
  return runIdByToolCallId.get(toolCallId);
}

/** First active run id (used when the console has one obvious target). */
export function getPrimaryActiveShellRunId(): string | undefined {
  const first = activeByRunId.keys().next();
  return first.done ? undefined : first.value;
}

export function listActiveShellRuns(): ShellRunEntry[] {
  return [...activeByRunId.values()];
}

export function isShellRunActive(runId: string): boolean {
  return activeByRunId.has(runId);
}

/** Subscribe to registry changes (show/hide kill buttons). */
export function subscribeShellRuns(listener: ShellRunListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: clear registry between cases. */
export function resetShellRunRegistryForTests(): void {
  activeByRunId.clear();
  runIdByToolCallId.clear();
  listeners.clear();
}
