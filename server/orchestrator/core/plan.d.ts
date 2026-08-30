import type { BoardState, Desired, Evidence, NextAction } from './types';

/**
 * What should happen to a task that has nothing in flight.
 * The only call site of `decide()` in the engine.
 */
export function nextAction(state: BoardState, taskId: string): NextAction;

/**
 * What a hand-started task should begin, if anything.
 *
 * Outside the concurrency cap (rule 4) and nothing else: dependencies, one
 * attempt per task, and `touches` exclusion still apply.
 */
export function manualStart(
  state: BoardState,
  taskId: string,
  running?: ReadonlyArray<{ taskId: string | null; role: string }>,
): NextAction;

/** Tasks whose tester passed but which are not yet on the merge queue. */
export function pendingEnqueues(state: BoardState): string[];

/**
 * Tasks that can never run because something upstream was abandoned or skipped.
 * The engine journals `task.skipped` for each. `blockedBy` is the abandoned root.
 */
export function pendingSkips(state: BoardState): Array<{ taskId: string; blockedBy: string }>;

/** Has the board finished everything it can, with final verification outstanding? */
export function isReadyForFinalTest(state: BoardState): boolean;

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
 * patterns. Frozen file expansion is {@link footprintsClash}.
 */
export function touchesOverlap(a: readonly string[], b: readonly string[]): boolean;

/**
 * Scheduling clash: declared glob overlap, or intersection of journaled
 * expanded file sets. Empty / missing expansion adds no extra clash.
 */
export function footprintsClash(
  a: { touches?: readonly string[] | null; touchesExpanded?: readonly string[] | null },
  b: { touches?: readonly string[] | null; touchesExpanded?: readonly string[] | null },
): boolean;

export function expandedFilesOverlap(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean;

/** Match declared globs against a file list. No I/O. */
export function expandTouches(
  globs: readonly string[],
  repoFiles: readonly string[],
): { expanded: string[]; emptyGlobs: string[] };

/** Changed paths that sit outside the declared globs. */
export function overflowPaths(declared: readonly string[], actual: readonly string[]): string[];

export function pathMatchesGlob(file: string, glob: string): boolean;

export function normalizeRepoPath(value: string): string;

/** Could these two globs match a common path? */
export function globsIntersect(a: string, b: string): boolean;
