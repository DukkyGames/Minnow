/**
 * Client helper: whether the Code workspace is a git repository.
 */

import { getWorkspacePath } from './workspace';

export interface WorkspaceGitStatus {
  ok: boolean;
  isGitRepo: boolean;
  hasRemote: boolean;
}

const EMPTY_GIT_STATUS: WorkspaceGitStatus = {
  ok: false,
  isGitRepo: false,
  hasRemote: false,
};

/**
 * Fetch git repo + origin remote flags for the workspace root.
 * When the tool server is unreachable, returns a failed status (preflight may still prompt).
 */
export async function getWorkspaceGitStatus(workspaceRoot?: string): Promise<WorkspaceGitStatus> {
  const root = workspaceRoot?.trim() || getWorkspacePath().trim();
  const params = root ? `?workspaceRoot=${encodeURIComponent(root)}` : '';
  try {
    const response = await fetch(`/api/workspace/git-status${params}`);
    if (!response.ok) return EMPTY_GIT_STATUS;
    const payload = (await response.json()) as WorkspaceGitStatus;
    if (!payload.ok) return EMPTY_GIT_STATUS;
    return {
      ok: true,
      isGitRepo: Boolean(payload.isGitRepo),
      hasRemote: Boolean(payload.hasRemote),
    };
  } catch {
    return EMPTY_GIT_STATUS;
  }
}

/**
 * Returns true when the workspace root is inside a git work tree.
 * When the tool server is unreachable, returns false (preflight may still prompt).
 */
export async function isWorkspaceGitRepo(workspaceRoot?: string): Promise<boolean> {
  const status = await getWorkspaceGitStatus(workspaceRoot);
  return status.isGitRepo;
}
