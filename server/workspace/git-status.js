/**
 * Workspace git repository detection for UI preflight checks.
 */

import { isGitRepository } from '../tools/git-change-stats.js';
import { getWorkspaceRoot } from './root.js';

/**
 * Whether the active Code workspace root is inside a git repository.
 * @param {string} [workspaceRoot] optional override (tests)
 * @returns {Promise<{ isGitRepo: boolean }>}
 */
export async function getWorkspaceGitStatus(workspaceRoot) {
  const root = workspaceRoot?.trim() || getWorkspaceRoot();
  const isGitRepo = await isGitRepository(root);
  return { isGitRepo };
}
