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
