/**
 * Workspace folder API — directory where AI tools operate.
 */

export interface WorkspaceInfo {
  ok?: boolean;
  path: string;
  label: string;
  isDefault: boolean;
}

export interface WorkspacePickResult {
  ok: boolean;
  cancelled: boolean;
  path: string | null;
  label?: string;
  isDefault?: boolean;
  error?: string;
}

/** Fetch the current workspace from the dev server. */
export async function fetchWorkspace(): Promise<WorkspaceInfo | null> {
  try {
    const res = await fetch('/api/workspace', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceInfo;
  } catch {
    return null;
  }
}

/** Open the native folder picker and set workspace when a folder is chosen. */
export async function pickWorkspaceFolder(): Promise<WorkspacePickResult> {
  const res = await fetch('/api/workspace/pick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const json = (await res.json()) as WorkspacePickResult & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      cancelled: false,
      path: null,
      error: json.error ?? `HTTP ${res.status}`,
    };
  }
  return json;
}

/** Set workspace by absolute path (validated on server). */
export async function setWorkspacePath(absPath: string): Promise<WorkspaceInfo> {
  const res = await fetch('/api/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: absPath }),
  });
  const json = (await res.json()) as WorkspaceInfo & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json;
}
