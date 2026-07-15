/**
 * In-memory run registry: active runs map and parent-chat/turn indexes.
 */

import { isSubAgentRunTerminal } from '../sub-agent-outcome';
import type { SubAgentRun } from '../types';
import type { RunInternals } from './types';
import { loadRegistry, mirrorRegistryEntry } from './persistence';

export { loadRegistry };

const runs = new Map<string, RunInternals>();
const parentTurnRuns = new Map<string, Set<string>>();
const parentChatRuns = new Map<string, Set<string>>();

/** Retain a short transcript tail after settle; full evict after this delay. */
export const TERMINAL_RUN_EVICT_MS = 60_000;
const TERMINAL_MESSAGE_TAIL = 6;

const evictTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Lookup mutable internals for a run id. */
export function getRunInternals(runId: string): RunInternals | undefined {
  return runs.get(runId);
}

/** Register a new run row. */
export function registerRun(runId: string, internals: RunInternals): void {
  runs.set(runId, internals);
  mirrorRegistryEntry(internals.run);
}

/** Public read-only view of a sub-agent run. */
export function getSubAgentRun(runId: string): SubAgentRun | undefined {
  return runs.get(runId)?.run;
}

/** Runs that are still queued or executing. */
export function listActiveSubAgentRuns(): SubAgentRun[] {
  return [...runs.values()]
    .map((i) => i.run)
    .filter((r) => r.status === 'queued' || r.status === 'running');
}

/** Link a run to its parent user-send turn for cancellation and listing. */
export function associateParentTurn(
  parentTurnId: string | null | undefined,
  runId: string,
): void {
  if (!parentTurnId) return;
  let set = parentTurnRuns.get(parentTurnId);
  if (!set) {
    set = new Set();
    parentTurnRuns.set(parentTurnId, set);
  }
  set.add(runId);
}

/** Link a run to its parent chat session for session-scoped status tools. */
export function associateParentChat(
  parentChatId: string | null | undefined,
  runId: string,
): void {
  if (!parentChatId) return;
  let set = parentChatRuns.get(parentChatId);
  if (!set) {
    set = new Set();
    parentChatRuns.set(parentChatId, set);
  }
  set.add(runId);
}

/** Clear per-run timeout handles before settle or reset. */
export function clearTimeoutFor(internals: RunInternals): void {
  if (internals.timeoutId) {
    clearTimeout(internals.timeoutId);
    internals.timeoutId = null;
  }
  if (internals.nudgeTimeoutId) {
    clearTimeout(internals.nudgeTimeoutId);
    internals.nudgeTimeoutId = null;
  }
}

/** Callbacks invoked when run wall-clock timeout or check-in nudge fires. */
export type RunTimerHandlers = {
  onTimeout: (runId: string) => void;
  onCheckInNudge: (runId: string) => void;
};

/**
 * Arm wall-clock timeout and optional check-in nudge when a run actually starts
 * (not while it waits in the global concurrency queue).
 */
export function armRunTimers(
  internals: RunInternals,
  timeoutMs: number,
  checkInNudgeMs: number,
  handlers: RunTimerHandlers,
): void {
  clearTimeoutFor(internals);
  const runId = internals.run.runId;
  if (timeoutMs > 0) {
    internals.timeoutId = setTimeout(() => handlers.onTimeout(runId), timeoutMs);
  }
  if (checkInNudgeMs > 0) {
    internals.nudgeTimeoutId = setTimeout(
      () => handlers.onCheckInNudge(runId),
      checkInNudgeMs,
    );
  }
}

/** Trim heavy transcript after settle; durability lives in persistence + session sync. */
export function trimRunMessagesOnSettle(run: SubAgentRun): void {
  if (run.messages.length <= TERMINAL_MESSAGE_TAIL) return;
  run.messages = run.messages.slice(-TERMINAL_MESSAGE_TAIL);
}

/** Remove a settled run from live maps after a grace window. */
export function evictRun(runId: string): void {
  const timer = evictTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    evictTimers.delete(runId);
  }

  const internals = runs.get(runId);
  if (!internals) return;
  if (!isSubAgentRunTerminal(internals.run.status)) return;

  runs.delete(runId);
  for (const set of parentTurnRuns.values()) {
    set.delete(runId);
  }
  for (const set of parentChatRuns.values()) {
    set.delete(runId);
  }
}

/** Schedule eviction of a terminal run from the in-memory registry. */
export function scheduleRunEviction(runId: string): void {
  if (typeof process !== 'undefined' && process.env.MINNOW_TEST === '1') return;
  if (evictTimers.has(runId)) return;
  const timer = setTimeout(() => {
    evictTimers.delete(runId);
    evictRun(runId);
  }, TERMINAL_RUN_EVICT_MS);
  evictTimers.set(runId, timer);
}

/** Active or settled runs registered for a parent user-send turn. */
export function listSubAgentRunsForParentTurn(
  parentTurnId: string | null | undefined,
): SubAgentRun[] {
  if (!parentTurnId) return [];
  const set = parentTurnRuns.get(parentTurnId);
  if (!set || set.size === 0) return [];
  const out: SubAgentRun[] = [];
  for (const id of set) {
    const row = runs.get(id)?.run;
    if (row) out.push(row);
  }
  return out.sort((a, b) =>
    String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')),
  );
}

/** Active or settled runs for a parent chat session (any parent turn). */
export function listSubAgentRunsForParentChat(
  parentChatId: string | null | undefined,
): SubAgentRun[] {
  if (!parentChatId) return [];
  const set = parentChatRuns.get(parentChatId);
  if (!set || set.size === 0) return [];
  const out: SubAgentRun[] = [];
  for (const id of set) {
    const row = runs.get(id)?.run;
    if (row) out.push(row);
  }
  return out.sort((a, b) =>
    String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')),
  );
}

/** Cancel all sub-agents tied to a parent send turn. */
export function getParentTurnRunIds(parentTurnId: string): Set<string> | undefined {
  return parentTurnRuns.get(parentTurnId);
}

/** Remove parent-turn index after bulk cancel. */
export function deleteParentTurnIndex(parentTurnId: string): void {
  parentTurnRuns.delete(parentTurnId);
}

/** Iterate all registered internals (used by reset). */
export function forEachRunInternals(
  fn: (internals: RunInternals) => void,
): void {
  for (const internals of runs.values()) {
    fn(internals);
  }
}

/** Wipe registry state (test reset). */
export function clearRegistry(): void {
  for (const timer of evictTimers.values()) {
    clearTimeout(timer);
  }
  evictTimers.clear();
  runs.clear();
  parentTurnRuns.clear();
  parentChatRuns.clear();
}
