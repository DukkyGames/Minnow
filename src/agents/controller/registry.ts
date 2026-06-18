/**
 * In-memory run registry: active runs map and parent-chat/turn indexes.
 */

import type { SubAgentRun } from '../types';
import type { RunInternals } from './types';
import { loadRegistry, mirrorRegistryEntry } from './persistence';

export { loadRegistry };

const runs = new Map<string, RunInternals>();
const parentTurnRuns = new Map<string, Set<string>>();
const parentChatRuns = new Map<string, Set<string>>();

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
  runs.clear();
  parentTurnRuns.clear();
  parentChatRuns.clear();
}
