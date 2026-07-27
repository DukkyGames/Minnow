/**
 * Shared git / worktree Uicons glyphs — MIN-276.
 * Used in composer run-target controls, git panel, board, and sidebar.
 */

import { createIcon, type IconName } from './icon';

export type GitWorktreeIconKind = 'local' | 'branch' | 'worktree';

const KIND_TO_ICON: Record<GitWorktreeIconKind, IconName> = {
  local: 'gitLocal',
  branch: 'gitBranch',
  worktree: 'gitWorktree',
};

/** @deprecated Use createGitWorktreeIcon — path constants removed. */
export const GIT_LOCAL_ICON_PATH = '';
export const GIT_BRANCH_ICON_PATH = '';
export const GIT_WORKTREE_ICON_PATH = '';

/** Create a Uicons icon for local / branch / worktree concepts. */
export function createGitWorktreeIcon(
  kind: GitWorktreeIconKind,
  className = 'icon-svg',
): HTMLElement {
  return createIcon(KIND_TO_ICON[kind], { className });
}
