import type { TurnEvent } from '../runner/run-turn';

export interface LiveAttemptEvent {
  boardId: string;
  attemptId: string;
  taskId: string | null;
  role: string;
  event: TurnEvent;
}

export function subscribeLive(
  boardId: string,
  handler: (payload: LiveAttemptEvent) => void,
): () => void;

export function emitLive(payload: LiveAttemptEvent): void;

/** A failure that stopped work from starting. Non-journaled — P9-A. */
export interface BoardErrorEvent {
  boardId: string;
  taskId: string | null;
  role: string;
  message: string;
  /** How many times this work has failed to start in a row. */
  consecutive: number;
}

export function subscribeErrors(
  boardId: string,
  handler: (payload: BoardErrorEvent) => void,
): () => void;

export function emitError(payload: BoardErrorEvent): void;
