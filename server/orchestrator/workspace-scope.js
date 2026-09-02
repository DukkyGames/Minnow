/** Which boards belong to the live workspace. */

import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceRoot, normalizeWorkspacePathKey } from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';
import {
  getBoardWorktreesDir,
  getRepoWorktreesDir,
  getWorktreesRoot,
} from '../worktree/paths.js';
import { sanitizePathSegment } from '../../src/lib/sanitize-path-segment.mjs';

/**
 * @param {string} absPath
 * @returns {Promise<boolean>}
 */
async function directoryExists(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when `~/.minnow/worktrees/<otherRepoKey>/<boardId>/` exists.
 * @param {string} boardId
 * @param {string} workspaceRoot
 * @returns {Promise<boolean>}
 */
async function boardHasSlotUnderOtherRepo(boardId, workspaceRoot) {
  const root = getWorktreesRoot();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  const currentKey = path.basename(getRepoWorktreesDir(workspaceRoot));
  const slotName = sanitizePathSegment(boardId);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === currentKey) continue;
    if (await directoryExists(path.join(root, entry.name, slotName))) return true;
  }
  return false;
}

/**
 * Plan file present in this workspace (relative planPath, never rewritten).
 *
 * @param {string} planPath
 * @param {string} workspaceRoot
 * @returns {Promise<boolean>}
 */
async function planExistsInWorkspace(planPath, workspaceRoot) {
  if (!planPath || typeof planPath !== 'string') return false;
  try {
    const resolved = path.isAbsolute(planPath)
      ? path.resolve(planPath)
      : path.resolve(workspaceRoot, planPath);
    if (!isResolvedPathUnderRoot(resolved, workspaceRoot)) return false;
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does this folded board belong to `workspaceRoot`?
 * @param {import('./core/types').BoardState} state
 * @param {string} [workspaceRoot]
 * @returns {Promise<boolean>}
 */
export async function boardBelongsToWorkspace(state, workspaceRoot = getWorkspaceRoot()) {
  if (!state || typeof state !== 'object') return false;
  const root = path.resolve(workspaceRoot);
  const stamped = typeof state.workspacePath === 'string' ? state.workspacePath.trim() : '';
  if (stamped) {
    return normalizeWorkspacePathKey(stamped) === normalizeWorkspacePathKey(root);
  }

  const boardId = typeof state.boardId === 'string' ? state.boardId : '';
  if (boardId && (await directoryExists(getBoardWorktreesDir(boardId, root)))) {
    return true;
  }

  const repoDir = getRepoWorktreesDir(root);
  const tasks = state.tasks;
  if (tasks && typeof tasks.values === 'function') {
    for (const task of tasks.values()) {
      const attempts = Array.isArray(task?.attempts) ? task.attempts : [];
      for (const attempt of attempts) {
        const worktree = typeof attempt?.worktree === 'string' ? attempt.worktree : '';
        if (!worktree) continue;
        try {
          if (isResolvedPathUnderRoot(path.resolve(worktree), repoDir)) return true;
        } catch {
        }
      }
    }
  }

  if (!boardId) return false;
  const otherSlot = await boardHasSlotUnderOtherRepo(boardId, root);
  if (otherSlot) return false;
  return planExistsInWorkspace(state.planPath, root);
}
