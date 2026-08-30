import type { Attempt, BoardState, Role, TaskState } from './types';

/**
 * First `board.started` when the caller omits N. The fold stays at 1 until
 * that event — a created board is not yet running.
 */
export const DEFAULT_BOARD_CONCURRENCY: 2;

/** Fold a journal into board state. Total: never throws, whatever the input. */
export function derive(events: Iterable<unknown>): BoardState;

/** The state of a board with no journal at all. Pre-start concurrency is 1. */
export function emptyState(): BoardState;

/**
 * Fold events into an existing state, in place, and recompute phases.
 * The resume path for `snapshot.js`.
 */
export function foldInto(state: BoardState, events: Iterable<unknown>): BoardState;

/** The most recent attempt that finished, or undefined if none has. */
export function lastEndedAttempt(task: TaskState): Attempt | undefined;

/**
 * How many attempts of a role have finished for a task.
 * The single accessor — there is no stored counter to read instead.
 */
export function attemptCount(state: BoardState, taskId: string, role: Role): number;

/**
 * Tasks whose every dependency has merged and which are not themselves finished,
 * in declared order. Not capped by concurrency — that is `plan()`'s job.
 */
export function readyTasks(state: BoardState): string[];

/**
 * Tasks that can never run because an upstream task is abandoned or skipped.
 * Values are the abandoned root (MIN-712), not the immediate skipped parent.
 */
export function deadEnded(state: BoardState): Map<string, string>;
