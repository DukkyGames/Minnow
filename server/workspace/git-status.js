/**
 * Workspace git repository detection for UI preflight checks.
 */

import { runProcess } from '../process-runner.js';
import { isGitRepository } from '../tools/git-change-stats.js';
import { getWorkspaceRoot } from './root.js';

/** True when `origin` has a configured URL in the workspace root. */
async function hasOriginRemote(cwd) {
  try {
    const result = await runProcess('git', ['remote', 'get-url', 'origin'], { cwd });
    return Boolean(String(result.stdout ?? '').trim());
  } catch {
    return false;
  }
}

/**
 * Whether the active Code workspace root is inside a git repository.
 * @param {string} [workspaceRoot] optional override (tests)
 * @returns {Promise<{ isGitRepo: boolean; hasRemote: boolean }>}
 */
export async function getWorkspaceGitStatus(workspaceRoot) {
  const root = workspaceRoot?.trim() || getWorkspaceRoot();
  const isGitRepo = await isGitRepository(root);
  const hasRemote = isGitRepo ? await hasOriginRemote(root) : false;
  return { isGitRepo, hasRemote };
}
