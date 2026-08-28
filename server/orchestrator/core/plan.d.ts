import type { BoardState, Desired, Evidence, NextAction } from './types';

/**
 * What should happen to a task that has nothing in flight.
 * The only call site of `decide()` in the engine.
 */
export function nextAction(state: BoardState, taskId: string): NextAction;

/** Tasks whose tester passed but which are not yet on the merge queue. */
export function pendingEnqueues(state: BoardState): string[];

/** Tasks the policy table has given up on, with the evidence for each. */
export function pendingAbandonments(
  state: BoardState,
): Array<{ taskId: string; reason: string; evidence: Evidence }>;

/**
 * Which attempts should be running right now. Pure, total, and deterministic in
 * output order — replay depends on the order, not just the set.
 */
export function plan(state: BoardState): Desired[];

/** Declared task order, stably keyed on wave first. */
export function orderedTaskIds(state: BoardState): string[];

/**
 * Do two declared footprints overlap? Pure glob-set intersection over
 * already-expanded patterns; matching against real files is P3-D's job.
 */
export function touchesOverlap(a: readonly string[], b: readonly string[]): boolean;

/** Could these two globs match a common path? */
export function globsIntersect(a: string, b: string): boolean;
