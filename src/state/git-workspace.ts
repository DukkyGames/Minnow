/**
 * Client helper: whether the Code workspace is a git repository.
 */

import { getWorkspacePath } from './workspace';

export interface WorkspaceGitStatus {
  ok: boolean;
  isGitRepo: boolean;
}

/**
 * Returns true when the workspace root is inside a git work tree.
 * When the tool server is unreachable, returns false (preflight may still prompt).
 */
export async function isWorkspaceGitRepo(workspaceRoot?: string): Promise<boolean> {
  const root = workspaceRoot?.trim() || getWorkspacePath().trim();
  const params = root ? `?workspaceRoot=${encodeURIComponent(root)}` : '';
  try {
    const response = await fetch(`/api/workspace/git-status${params}`);
    if (!response.ok) return false;
    const payload = (await response.json()) as WorkspaceGitStatus;
    return Boolean(payload.ok && payload.isGitRepo);
  } catch {
    return false;
  }
}
