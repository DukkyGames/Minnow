/**
 * Client helper: initialize git in the workspace (board onboarding, MIN-615).
 */

import { getWorkspacePath } from './workspace';

/** Result of POST /api/workspace/initialize-git. */
export interface InitializeWorkspaceGitResult {
  ok: boolean;
  alreadyRepo?: boolean;
  createdRepo?: boolean;
  gitignoreCreated?: boolean;
  committed?: boolean;
  commitSha?: string;
  usedFallbackIdentity?: boolean;
  error?: string;
}

/**
 * POST /api/workspace/initialize-git — init, baseline .gitignore, initial commit.
 * Safe to call on an existing repo (skips init; skips commit when HEAD exists).
 */
export async function initializeWorkspaceGit(
  workspaceRoot?: string,
): Promise<InitializeWorkspaceGitResult> {
  const root = workspaceRoot?.trim() || getWorkspacePath().trim();
  try {
    const response = await fetch('/api/workspace/initialize-git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(root ? { workspaceRoot: root } : {}),
    });
    const payload = (await response.json()) as InitializeWorkspaceGitResult;
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        error: payload.error ?? `HTTP ${response.status}`,
      };
    }
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
