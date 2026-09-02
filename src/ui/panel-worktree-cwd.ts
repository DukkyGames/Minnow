import {
  normalizeWorktreePath,
  worktreePathsEqual,
} from '../lib/worktree-list-parse';
import { resolveChatWorktreeRoot } from '../state/chat-worktree';
import { getWorkspacePath } from '../state/workspace';
import type { Chat, ChatGroup } from '../types';

/** Normalize path separators, drive casing, and trailing slashes for panel comparisons. */
export function normalizePanelPath(p: string): string {
  return normalizeWorktreePath(p);
}

/** True when two panel paths refer to the same directory (Windows-safe). */
export function panelPathsEqual(a: string, b: string): boolean {
  return worktreePathsEqual(a, b);
}

/** Effective worktree root for panel-scoped git/file ops. */
export function resolvePanelWorktreeCwd(panelCwd?: string): string | undefined {
  const ws = getWorkspacePath().trim();
  if (!panelCwd?.trim()) return undefined;
  if (ws && panelPathsEqual(panelCwd, ws)) return undefined;
  return panelCwd;
}

export interface PanelWorktreeBranchEntry {
  path: string;
  branch?: string;
}

/** Composer run-target seed when the user manually picked a browse root in Source Control. */
export type PanelBrowseRunTargetSeed =
  | { kind: 'local' }
  | { kind: 'worktree'; worktreeRoot: string; gitBranch?: string };

/** Map a manual git-panel worktree pick to a composer run-target for new chats. */
export function resolvePanelBrowseRunTargetSeed(
  panelCwd: string | undefined,
  panelCwdUserOverride: boolean,
  knownWorktrees: PanelWorktreeBranchEntry[],
): PanelBrowseRunTargetSeed | null {
  if (!panelCwdUserOverride) return null;
  const root = resolvePanelWorktreeCwd(panelCwd);
  if (!root) return { kind: 'local' };
  const match = knownWorktrees.find((wt) => panelPathsEqual(wt.path, root));
  return {
    kind: 'worktree',
    worktreeRoot: root,
    gitBranch: match?.branch,
  };
}

export function resolvePanelBrowseCwd(input: {
  chat: Chat;
  groups?: ChatGroup[];
}): string {
  const { chat, groups } = input;
  const worktreeRoot = resolveChatWorktreeRoot(chat, groups);

  if (worktreeRoot) return worktreeRoot;
  return getWorkspacePath().trim() || '.';
}

/**
 * Pick a worktree path that exists in `worktrees`, falling back to the workspace root entry.
 */
export function resolveKnownWorktreePath(
  worktrees: PanelWorktreeBranchEntry[],
  desiredPath: string | undefined,
  workspaceRoot: string,
): string {
  const ws = workspaceRoot.trim();
  const desired = (desiredPath?.trim() || ws).trim();
  if (!desired) return worktrees[0]?.path ?? '';

  const exact = worktrees.find((wt) => panelPathsEqual(wt.path, desired));
  if (exact) return exact.path;

  const main = worktrees.find((wt) => panelPathsEqual(wt.path, ws));
  if (main) return main.path;

  return worktrees[0]?.path ?? ws;
}

/**
 * Reset panel cwd when it no longer appears in the worktree list (e.g. after removal).
 */
export function normalizePanelCwdAfterWorktreeListChange(
  panelCwd: string | undefined,
  worktrees: PanelWorktreeBranchEntry[],
  workspaceRoot: string,
): string | undefined {
  const ws = workspaceRoot.trim();
  if (!ws) return panelCwd;
  const desired = panelCwd?.trim();
  if (desired && worktrees.some((wt) => panelPathsEqual(wt.path, desired))) {
    return panelCwd;
  }
  const resolved = resolveKnownWorktreePath(worktrees, ws, ws);
  return panelPathsEqual(resolved, ws) ? undefined : resolved;
}
