/**
 * Registered git worktree allowlist for workspaceRoot validation (browse + agent cwd).
 * Extends the fixed sandbox roots so file tools can target any `git worktree list` path
 * and repo-local `.worktrees/` slots without Full disk access.
 */

import path from 'node:path';
import { getWorkspaceRoot, normalizeWorkspacePathKey } from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';
import { listWorktrees } from './worktree-ops.js';

const CACHE_TTL_MS = 30_000;

/** @type {{ paths: Set<string>, expiresAt: number } | null} */
let cache = null;

/** Parse absolute worktree paths from `git worktree list --porcelain`. */
function parseWorktreePaths(porcelain) {
  const paths = [];
  for (const rawLine of String(porcelain ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.startsWith('worktree ')) continue;
    const wt = line.slice('worktree '.length).trim();
    if (wt) paths.push(path.resolve(wt));
  }
  return paths;
}

/** Repo-local default worktrees folder (`git worktree add .worktrees/...`). */
function getRepoLocalWorktreesDir(workspaceRoot = getWorkspaceRoot()) {
  return path.join(path.resolve(workspaceRoot), '.worktrees');
}

/** Drop cached registered worktree paths (call after add/remove). */
export function invalidateRegisteredWorktreeCache() {
  cache = null;
}

/**
 * Load registered worktree paths for the active Code workspace (cached ~30s).
 * @returns {Promise<Set<string>>}
 */
async function loadRegisteredWorktreePaths() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.paths;
  }

  const paths = new Set();
  const list = await listWorktrees();
  if (list.ok && list.output) {
    for (const wt of parseWorktreePaths(list.output)) {
      paths.add(normalizeWorkspacePathKey(wt));
    }
  }

  cache = { paths, expiresAt: now + CACHE_TTL_MS };
  return paths;
}

/**
 * True when resolvedPath is a registered git worktree for the open repo or under
 * repo-local `.worktrees/` (even before git registers the path).
 * @param {string} resolvedPath
 */
export async function isRegisteredGitWorktreePath(resolvedPath) {
  if (!resolvedPath || typeof resolvedPath !== 'string') return false;
  const resolved = path.resolve(resolvedPath.trim());
  const key = normalizeWorkspacePathKey(resolved);

  const registered = await loadRegisteredWorktreePaths();
  if (registered.has(key)) return true;

  const localWtDir = getRepoLocalWorktreesDir();
  return isResolvedPathUnderRoot(resolved, localWtDir);
}

/**
 * Synchronous check for repo-local `.worktrees/` only (no git subprocess).
 * @param {string} resolvedPath
 */
export function isRepoLocalWorktreePath(resolvedPath) {
  if (!resolvedPath || typeof resolvedPath !== 'string') return false;
  const resolved = path.resolve(resolvedPath.trim());
  return isResolvedPathUnderRoot(resolved, getRepoLocalWorktreesDir());
}
