import type { BoardState } from './core/types';
import type { RunnerDeps, PostChatCompletions } from '../runner/adapters';
import type { TurnModel, TurnResult, RunTurnOptions } from '../runner/run-turn';
import type * as diskJournal from './journal';

export function cancelOrphanedRunnerGenerations(): number;

export interface RunnerEffector {
  inspect(): Array<{ taskId: string | null; role: string; attemptId: string; worktree?: string }>;
  start(desired: {
    taskId: string | null;
    role: string;
    seedKind?: string;
    sameWorktree?: boolean;
  }): Promise<{ attemptId: string; worktree?: string; discarded?: Record<string, unknown>[] }>;
  stop(attemptId: string): Promise<void>;
  /** Check the model binding and role prompts. Throws when something is missing. */
  preflight(): Promise<void>;
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
      discarded?: Record<string, unknown>;
    }) => Promise<void> | void,
  ): void;
  readonly started: Array<{
    taskId: string | null;
    role: string;
    attemptId: string;
    seedKind?: string;
    worktree?: string;
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
  /**
   * P3-F test seam. When set, Final always uses this instead of instant-pass,
   * even if `runTurn` is also injected.
   */
  runFinalLadder?: (input: {
    cwd: string;
    planPath?: string | null;
    signal?: AbortSignal;
  }) => Promise<{
    outcome: 'pass' | 'fail';
    runInstructions: string;
    summary: string;
    evidence: Record<string, unknown>;
  }>;
  deps?: RunnerDeps;
  postChatCompletions?: PostChatCompletions;
  /** Cancel persist:false generations not owned by a live attempt. Default false. */
  reapOrphans?: boolean;
  /**
   * Allocate an isolated git worktree per builder/tester attempt (MIN-705).
   * Defaults on when `cwd` is omitted (production). Explicit `cwd` is the
   * P2-F sandbox seam and leaves isolation off unless this is set true.
   */
  worktrees?: boolean;
}

export function createRunnerEffector(
  options?: CreateRunnerEffectorOptions,
): RunnerEffector;
