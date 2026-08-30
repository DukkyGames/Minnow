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
