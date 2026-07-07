/**
 * Client helper: ensure a baseline .gitignore exists in the workspace root.
 */

import { getWorkspacePath } from './workspace';

export interface EnsureBaselineGitignoreResult {
  ok: boolean;
  created: boolean;
  path?: string;
  error?: string;
}

/**
 * POST /api/workspace/ensure-baseline-gitignore — create default ignores when missing.
 */
export async function ensureBaselineGitignore(
  workspaceRoot?: string,
): Promise<EnsureBaselineGitignoreResult> {
  const root = workspaceRoot?.trim() || getWorkspacePath().trim();
  try {
    const response = await fetch('/api/workspace/ensure-baseline-gitignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(root ? { workspaceRoot: root } : {}),
    });
    const payload = (await response.json()) as EnsureBaselineGitignoreResult & { error?: string };
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        created: false,
        error: payload.error ?? `HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      created: Boolean(payload.created),
      path: payload.path,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, created: false, error: message };
  }
}
