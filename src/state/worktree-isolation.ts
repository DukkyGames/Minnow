/**
 * Pure helpers for MIN-275 board worktree isolation: mode resolution, branch/slot
 * naming, and dev-port allocation. No server or filesystem access — the worktree
 * service ({@link file://./worktree-service.ts}) and the server worktree ops own
 * actual git/path work. Kept pure so it is unit-testable and reusable by MIN-276.
 */

import { getAutopilotMetaSync } from '../config/autopilot-meta.ts';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import { isMinnowSandboxWorkspacePath } from '../lib/workspace-sandbox.ts';
import type { BoardTask, Chat, ChatGroup, OrchestrateBoardState } from '../types.ts';

export type IsolationMode = 'off' | 'per-task' | 'per-wave';

/** Default base port for isolated dev servers (server may override via env). */
export const DEFAULT_BOARD_PORT_BASE = 5200;

/** Offset above {@link DEFAULT_BOARD_PORT_BASE} client port for the API server port. */
export const DEFAULT_BOARD_API_PORT_OFFSET = 100;

/**
 * Effective isolation mode: per-board override, then global default (when not `auto`),
 * then derive from execution mode.
 * - `auto` / `afk` execution → `per-task`
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
  const globalIso = getAutopilotMetaSync().isolationMode;
  if (globalIso === 'off' || globalIso === 'per-task' || globalIso === 'per-wave') {
    return globalIso;
  }
  switch (board.executionMode) {
    case 'auto':
    case 'afk':
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

/** Ports already assigned to tasks (client + API) for {@link allocateDevPort}. */
export function usedDevPorts(tasks: BoardTask[]): number[] {
  const ports: number[] = [];
  for (const t of tasks) {
    if (typeof t.devPort === 'number' && Number.isFinite(t.devPort)) ports.push(t.devPort);
    if (typeof t.apiPort === 'number' && Number.isFinite(t.apiPort)) ports.push(t.apiPort);
  }
  return ports;
}

/** Allocate a non-colliding Vite client port and Express/API port for one board task. */
export function allocateTaskPorts(
  base: number,
  used: Iterable<number>,
): { devPort: number; apiPort: number } {
  const devPort = allocateDevPort(base, used);
  const apiPort = allocateDevPort(
    devPort + DEFAULT_BOARD_API_PORT_OFFSET,
    [...used, devPort],
  );
  return { devPort, apiPort };
}

/**
 * Resolve the tool workspace root for a board task chat: prefer the chat's
 * `worktreeRoot`, then fall back to the linked board task's `worktreePath`.
 */
export function resolveChatWorktreeRoot(
  chat: Pick<Chat, 'worktreeRoot' | 'boardTaskId' | 'boardGroupId'>,
  groups: ChatGroup[] | undefined,
): string | undefined {
  const direct = chat.worktreeRoot?.trim();
  if (direct) return direct;

  const taskId = chat.boardTaskId?.trim();
  const groupId = chat.boardGroupId?.trim();
  if (!taskId || !groupId || !groups?.length) return undefined;

  const group = groups.find((g) => g.id === groupId);
  const task = group?.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  return task?.worktreePath?.trim() || undefined;
}

/**
 * Tool workspace root for a chat: isolated worktree when present, otherwise the
 * chat's bound sandbox (~/.minnow/workspace or ~/.minnow/chats) or board project
 * workspace. Plain Code chats without a worktree return undefined so callers fall
 * back to the live top-bar workspace.
 */
export function resolveChatToolWorkspaceRoot(
  chat: Pick<Chat, 'worktreeRoot' | 'boardTaskId' | 'boardGroupId' | 'workspacePath'>,
  groups: ChatGroup[] | undefined,
): string | undefined {
  const worktree = resolveChatWorktreeRoot(chat, groups);
  if (worktree) return worktree;

  const ws = chat.workspacePath?.trim();
  if (!ws) return undefined;
  const normalized = normalizeWorkspacePath(ws);

  if (chat.boardGroupId?.trim()) return normalized;
  if (isMinnowSandboxWorkspacePath(normalized)) return normalized;
  return undefined;
}

/**
 * Derive board worktree directory roots from persisted task paths so permission
 * checks treat ~/.minnow/worktrees/… as in-scope for board-linked chats.
 */
export function boardWorktreesRootsFromState(
  groups: ChatGroup[] | undefined,
): string[] {
  const roots = new Set<string>();
  if (!groups?.length) return [];
  for (const group of groups) {
    const board = group.orchestrateBoard;
    if (!board) continue;
    for (const task of board.tasks) {
      const wt = task.worktreePath?.trim();
      if (!wt) continue;
      const normalized = wt.replace(/\\/g, '/');
      const match = normalized.match(/^(.+\/worktrees\/[^/]+\/[^/]+)/);
      if (match?.[1]) roots.add(match[1]);
    }
  }
  return [...roots];
}
