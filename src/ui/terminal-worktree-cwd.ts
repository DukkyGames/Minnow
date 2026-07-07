/**
 * Terminal cwd resolution — mirrors file explorer / git panel worktree (MIN-349).
 */

import { getWorkspacePath } from '../state/workspace';
import { getGitPanelCwd } from './git-panel';
import { getFileTreeListingWorkspaceRoot } from './file-tree-listing-root';
import { normalizePanelPath, panelPathsEqual } from './panel-worktree-cwd';

/**
 * Absolute cwd for new PTY sessions: same root as the file explorer
 * (listing worktree when set, else git panel cwd, else main workspace).
 */
export function resolveFileExplorerTerminalCwd(): string {
  const listingRoot = getFileTreeListingWorkspaceRoot()?.trim();
  if (listingRoot) return listingRoot;
  const panelCwd = getGitPanelCwd()?.trim();
  if (panelCwd) return panelCwd;
  return getWorkspacePath().trim() || '.';
}

/** True when cwd is a worktree distinct from the main workspace. */
export function isTerminalWorktreeCwd(cwd: string): boolean {
  const ws = getWorkspacePath().trim();
  if (!ws) return false;
  return !panelPathsEqual(cwd, ws);
}

/** Muted header suffix when browsing a task worktree (e.g. " · task-abc"). */
export function getTerminalCwdLabelSuffix(cwd: string): string {
  if (!isTerminalWorktreeCwd(cwd)) return '';
  const base = normalizePanelPath(cwd).split('/').filter(Boolean).pop();
  return base ? ` · ${base}` : '';
}

/** Short label for the terminal header cwd chip. */
export function formatTerminalCwdHeader(cwd: string): string {
  const normalized = normalizePanelPath(cwd);
  const base = normalized.split('/').filter(Boolean).pop() ?? cwd;
  if (isTerminalWorktreeCwd(cwd)) {
    return `${base} (worktree)`;
  }
  return base;
}

export interface TerminalShellHintOptions {
  /** File explorer root changed while a PTY tab is open elsewhere. */
  scopeChanged?: boolean;
  activeShellDiffers?: boolean;
}

/** Shell policy hint text; reflects file-explorer worktree cwd and scope-change guidance. */
export function formatTerminalShellHint(
  cwd: string,
  options?: TerminalShellHintOptions,
): string {
  const baseHint =
    'Shell has full access on your machine (not limited by workspace tool policy).';
  if (options?.scopeChanged && options?.activeShellDiffers) {
    const suffix = getTerminalCwdLabelSuffix(cwd);
    const label = suffix ? suffix.slice(3) : formatTerminalCwdHeader(cwd);
    return `File root changed — open a new terminal tab (+) to start in ${label}. Current shell keeps its directory.`;
  }
  if (isTerminalWorktreeCwd(cwd)) {
    return `Shell cwd: ${cwd} (file explorer worktree). ${baseHint}`;
  }
  return baseHint;
}

/** Compare two terminal cwd paths (undefined-safe via panel normalization). */
export function terminalCwdsEqual(a: string, b: string): boolean {
  return panelPathsEqual(a, b);
}
