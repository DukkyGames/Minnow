/**
 * Shared git-panel / file-tree worktree cwd resolution (avoids circular imports).
 */

import { getWorkspacePath } from '../state/workspace';

/** Normalize path separators and trailing slashes for panel comparisons. */
export function normalizePanelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** True when two panel paths refer to the same directory. */
export function panelPathsEqual(a: string, b: string): boolean {
  return normalizePanelPath(a) === normalizePanelPath(b);
}

/**
 * Effective worktree root for panel-scoped git/file ops.
 * Returns undefined when panel cwd is empty or equals the main workspace.
 */
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

/**
 * Map a manual git-panel worktree pick to a composer run-target for new chats.
 * Returns null when browse override is off (new chats keep default Local).
 */
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
