/**
 * Worktree storage paths under MINNOW_HOME (~/.minnow/worktrees).
 * Board task isolation (MIN-275) lives here, off to the side of the Code workspace
 * so git does not scan worktrees as nested repos and there is no .gitignore churn.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { getWorkspaceRoot, normalizeWorkspacePathKey } from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';

const WORKTREES_DIR_NAME = 'worktrees';

/** Sanitize an id into a safe single path segment. */
function seg(value) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'x';
}

/** Absolute root for all board worktrees. */
export function getWorktreesRoot() {
  return path.join(getMinnowHome(), WORKTREES_DIR_NAME);
}

/** Stable per-repo key (basename + short hash of the resolved path). */
export function repoKeyForWorkspace(workspaceRoot = getWorkspaceRoot()) {
  const resolved = path.resolve(workspaceRoot);
  const base = seg(path.basename(resolved)) || 'repo';
  const hash = crypto
    .createHash('sha1')
    .update(normalizeWorkspacePathKey(resolved))
    .digest('hex')
    .slice(0, 8);
  return `${base}-${hash}`;
}

/** Per-repo worktrees directory. */
export function getRepoWorktreesDir(workspaceRoot = getWorkspaceRoot()) {
  return path.join(getWorktreesRoot(), repoKeyForWorkspace(workspaceRoot));
}

/** Per-board worktrees directory. */
export function getBoardWorktreesDir(boardId, workspaceRoot = getWorkspaceRoot()) {
  return path.join(getRepoWorktreesDir(workspaceRoot), seg(boardId));
}

/** Absolute path for a single worktree slot (e.g. `task-T1`, `wave-W1`, `integration`). */
export function getWorktreeSlotPath(boardId, slotId, workspaceRoot = getWorkspaceRoot()) {
  return path.join(getBoardWorktreesDir(boardId, workspaceRoot), seg(slotId));
}

/** True when an absolute path lives under the worktrees root (allowlist guard). */
export function isPathUnderWorktreesRoot(absPath) {
  if (!absPath || typeof absPath !== 'string') return false;
  return isResolvedPathUnderRoot(path.resolve(absPath), getWorktreesRoot());
}
