/**
 * Resolve the workspace directory for a scheduled job run.
 */

import { ensureSchedulerWorkspace, getSchedulerWorkspacePath } from '../scheduler-workspace/paths.js';

/**
 * Per-job workspace override, or the default ~/.minnow/scheduler-workspace.
 * @param {{ workspacePath?: string }} storedJob
 * @returns {Promise<string>} absolute workspace path
 */
export async function resolveJobWorkspacePath(storedJob) {
  const override =
    typeof storedJob.workspacePath === 'string' ? storedJob.workspacePath.trim() : '';
  if (override) {
    return override;
  }
  await ensureSchedulerWorkspace();
  return getSchedulerWorkspacePath();
}
