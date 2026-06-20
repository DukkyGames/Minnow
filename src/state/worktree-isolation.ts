/**
 * Pure helpers for MIN-275 board worktree isolation: mode resolution, branch/slot
 * naming, and dev-port allocation. No server or filesystem access — the worktree
 * service ({@link file://./worktree-service.ts}) and the server worktree ops own
 * actual git/path work. Kept pure so it is unit-testable and reusable by MIN-276.
 */

import type { BoardTask, OrchestrateBoardState } from '../types.ts';

export type IsolationMode = 'off' | 'per-task' | 'per-wave';

/** Default base port for isolated dev servers (server may override via env). */
export const DEFAULT_BOARD_PORT_BASE = 5200;

/**
 * Effective isolation mode for a board: explicit `board.isolationMode` override wins,
 * otherwise derived from the autonomy/execution mode.
 * - `auto` (and future `afk`) → `per-task`
 * - `sequential` / `manual` / unset → `off`
 */
export function resolveIsolationMode(
  board: OrchestrateBoardState | null | undefined,
): IsolationMode {
  if (!board) return 'off';
  const explicit = board.isolationMode;
  if (explicit === 'off' || explicit === 'per-task' || explicit === 'per-wave') {
    return explicit;
  }
  switch (board.executionMode) {
    case 'auto':
      return 'per-task';
    case 'sequential':
    case 'manual':
    default:
      return 'off';
  }
}

/** True when the board isolates task work into separate git worktrees. */
export function isIsolationActive(
  board: OrchestrateBoardState | null | undefined,
): boolean {
  return resolveIsolationMode(board) !== 'off';
}

/**
 * Sanitize an id fragment into a safe git ref / path segment: keep word chars,
 * dot, dash, underscore; collapse the rest to a single dash; bound length.
 */
export function sanitizeRefFragment(raw: string | number): string {
  const cleaned = String(raw)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return cleaned || 'x';
}

/** Board integration branch — task/wave branches merge into this. */
export function boardIntegrationBranch(boardId: string): string {
  return `minnow/board/${sanitizeRefFragment(boardId)}/integration`;
}

/** Per-task branch (per-task mode). */
export function taskWorktreeBranch(boardId: string, taskId: string): string {
  return `minnow/board/${sanitizeRefFragment(boardId)}/task/${sanitizeRefFragment(taskId)}`;
}

/** Shared per-wave branch (per-wave mode). */
export function waveWorktreeBranch(boardId: string, waveId: string | number): string {
  return `minnow/board/${sanitizeRefFragment(boardId)}/wave/${sanitizeRefFragment(waveId)}`;
}

/**
 * Worktree slot id for a task under the given mode — identifies the worktree dir
 * within the board. `per-task` → one per task; `per-wave` → shared per wave.
 * Returns null when isolation is off.
 */
export function worktreeSlotId(mode: IsolationMode, task: BoardTask): string | null {
  if (mode === 'per-task') return `task-${sanitizeRefFragment(task.id)}`;
  if (mode === 'per-wave') return `wave-${sanitizeRefFragment(task.wave)}`;
  return null;
}

/** Branch backing a task's worktree under the given mode, or null when off. */
export function worktreeBranchFor(
  mode: IsolationMode,
  boardId: string,
  task: BoardTask,
): string | null {
  if (mode === 'per-task') return taskWorktreeBranch(boardId, task.id);
  if (mode === 'per-wave') return waveWorktreeBranch(boardId, task.wave);
  return null;
}

/**
 * Tasks that share a worktree slot with the given task (the task itself plus, in
 * per-wave mode, every other task in the same wave). Used to know when a shared
 * worktree can be cleaned up.
 */
export function tasksSharingSlot(
  mode: IsolationMode,
  task: BoardTask,
  allTasks: BoardTask[],
): BoardTask[] {
  if (mode === 'per-wave') {
    return allTasks.filter((t) => String(t.wave) === String(task.wave));
  }
  if (mode === 'per-task') return [task];
  return [];
}

/** Lowest free port at/above `base` not present in `used`. */
export function allocateDevPort(base: number, used: Iterable<number>): number {
  const taken = new Set<number>();
  for (const p of used) {
    if (Number.isFinite(p)) taken.add(p);
  }
  let port = Math.max(1, Math.floor(base));
  while (taken.has(port)) port += 1;
  return port;
}

/** Ports already assigned to tasks (for {@link allocateDevPort}). */
export function usedDevPorts(tasks: BoardTask[]): number[] {
  return tasks
    .map((t) => t.devPort)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
}
