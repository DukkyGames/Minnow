import type { Attempt, BoardState, Role, TaskState } from './types';

/** Fold a journal into board state. Total: never throws, whatever the input. */
export function derive(events: Iterable<unknown>): BoardState;

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

/** Tasks that can never run because an upstream task is abandoned or skipped. */
export function deadEnded(state: BoardState): Map<string, string>;
