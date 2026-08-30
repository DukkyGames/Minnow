import type { BoardState } from './core/types';
import type { RunnerDeps, PostChatCompletions } from '../runner/adapters';
import type { TurnModel, TurnResult, RunTurnOptions } from '../runner/run-turn';
import type * as diskJournal from './journal';

export function cancelOrphanedRunnerGenerations(): number;

export interface RunnerEffector {
  inspect(): Array<{ taskId: string | null; role: string; attemptId: string }>;
  start(desired: {
    taskId: string | null;
    role: string;
    seedKind?: string;
    sameWorktree?: boolean;
  }): Promise<{ attemptId: string; worktree?: string }>;
  stop(attemptId: string): Promise<void>;
  onEnd(
    handler: (end: {
      attemptId: string;
      taskId: string | null;
      role: string;
      outcome: string;
      summary?: string;
      evidence?: Record<string, unknown>;
      sha?: string;
      files?: string[];
      runInstructions?: string;
    }) => Promise<void> | void,
  ): void;
  readonly started: Array<{
    taskId: string | null;
    role: string;
    attemptId: string;
    seedKind?: string;
  }>;
  vanishAll(): void;
}

export interface CreateRunnerEffectorOptions {
  boardId?: string;
  journal?: typeof diskJournal;
  getState?: () => BoardState | Promise<BoardState>;
  model?: TurnModel;
  cwd?: string;
  limits?: { maxTurns?: number; wallClockMs?: number };
  promptVariant?: 'full' | 'lite';
  runTurn?: (options: RunTurnOptions) => Promise<TurnResult>;
  deps?: RunnerDeps;
  postChatCompletions?: PostChatCompletions;
  /** Cancel persist:false generations not owned by a live attempt. Default false. */
  reapOrphans?: boolean;
}

export function createRunnerEffector(
  options?: CreateRunnerEffectorOptions,
): RunnerEffector;
