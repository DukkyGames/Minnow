/**
 * Client wrappers for the /api/worktree server ops (MIN-275 board task isolation).
 * All calls are best-effort: when the local server is unavailable the helpers return
 * a non-ok result so callers fall back to the shared workspace (no isolation) rather
 * than blocking task execution. Reusable by MIN-276.
 */

import { isLocalServerAvailable } from '../tools/config.ts';
import { reportBackgroundError } from '../boot/report-background-error.ts';

export interface WorktreeOpResult {
  ok: boolean;
  path?: string;
  branch?: string;
  created?: boolean;
  conflict?: boolean;
  output?: string;
  error?: string;
}

async function postWorktree(
  op: string,
  args: Record<string, unknown>,
): Promise<WorktreeOpResult> {
  if (!isLocalServerAvailable()) {
    return { ok: false, error: 'server_off' };
  }
  try {
    const res = await fetch('/api/worktree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...args }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return (await res.json()) as WorktreeOpResult;
  } catch (err) {
    reportBackgroundError('worktree-op', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ensure the board integration branch + its worktree exist. */
export function ensureIntegration(input: {
  boardId: string;
  branch: string;
  baseRef?: string;
}): Promise<WorktreeOpResult> {
  return postWorktree('ensure_integration', input);
}

/** Create (or attach) a task/wave worktree on its branch off the integration branch. */
export function createWorktree(input: {
  boardId: string;
  slotId: string;
  branch: string;
  baseRef?: string;
}): Promise<WorktreeOpResult> {
  return postWorktree('create', input);
}

/** Merge a task/wave branch into the board integration branch (inside its worktree). */
export function mergeIntoIntegration(input: {
  boardId: string;
  fromBranch: string;
  message?: string;
}): Promise<WorktreeOpResult> {
  return postWorktree('merge', input);
}

/** Remove a single worktree slot. */
export function removeWorktree(input: {
  boardId: string;
  slotId: string;
}): Promise<WorktreeOpResult> {
  return postWorktree('remove', input);
}

/** Remove all worktrees for a board (on completion / delete). */
export function cleanupBoardWorktrees(input: {
  boardId: string;
}): Promise<WorktreeOpResult> {
  return postWorktree('cleanup', input);
}
