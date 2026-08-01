/**
 * Client helper: open a workspace-relative file or folder in the OS explorer.
 */

import { isLocalServerAvailable } from '../tools/config';
import { buildFileTreeToolContext } from './file-tree-listing-root';
import { setStatus } from './status';

export interface RevealInSystemExplorerResult {
  ok: boolean;
  message: string;
}

/**
 * POST /api/workspace/reveal-in-explorer for the given tree path.
 * Surfaces errors via the status strip (same pattern as file-tree CRUD).
 */
export async function revealPathInSystemExplorer(
  workspaceRelativePath: string,
): Promise<RevealInSystemExplorerResult> {
  const trimmed = workspaceRelativePath?.trim();
  if (!trimmed) {
    const message = 'Path is required';
    setStatus('err', message);
    return { ok: false, message };
  }

  if (!isLocalServerAvailable()) {
    const message = 'Open Minnow to open paths in the system explorer.';
    setStatus('err', message);
    return { ok: false, message };
  }

  try {
    const { workspaceRoot } = buildFileTreeToolContext();
    const response = await fetch('/api/workspace/reveal-in-explorer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: trimmed,
        ...(workspaceRoot ? { workspaceRoot } : {}),
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; path?: string; kind?: string }
      | null;

    if (!response.ok || !data?.ok) {
      const message =
        (data && typeof data.error === 'string' && data.error) ||
        `Could not open in system explorer (${response.status})`;
      setStatus('err', message);
      return { ok: false, message };
    }

    return { ok: true, message: 'Opened in system explorer' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
    return { ok: false, message };
  }
}
