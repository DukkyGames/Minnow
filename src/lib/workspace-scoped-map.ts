/**
 * Lookup helper for the workspace-keyed maps in `config.json`
 * (`workspace.filePanelByPath`, `workspace.terminalByPath`,
 * `terminal.workspaceShellProfiles`).
 *
 * The client and the server do not — and cannot — produce identical keys. The
 * server writes them through `normalizeWorkspacePathKey`, which is
 * `path.resolve()` plus a Windows/macOS `realpath()` and a lowercase fold:
 * `c:\users\me\code\app`. The browser has neither `path` nor `realpath`, so
 * `normalizeWorkspacePath` produces `C:/Users/me/Code/app`.
 *
 * The result was that every write round-tripped into a key the reader never
 * looked up: per-workspace file-panel and terminal state was written on every
 * change and silently never restored, and each window fell back to the shared
 * legacy blob instead of its own folder's row.
 *
 * Reads therefore match loosely — case-insensitive, separator-insensitive — and
 * writes reuse the key already stored for that folder so a folder keeps exactly
 * one row.
 */

/** Case- and separator-insensitive form used only for comparing map keys. */
export function looseWorkspaceMapKey(key: string): string {
  if (!key || typeof key !== 'string') return '';
  let out = key.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out.toLowerCase();
}

/**
 * Find the stored key for `workspacePath` in a workspace-keyed map.
 * @returns the key as stored, or `undefined` when the folder has no row yet.
 */
export function findWorkspaceMapKey(
  map: Record<string, unknown> | null | undefined,
  workspacePath: string,
): string | undefined {
  if (!map || typeof map !== 'object') return undefined;
  const wanted = looseWorkspaceMapKey(workspacePath);
  if (!wanted) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, workspacePath)) return workspacePath;
  for (const key of Object.keys(map)) {
    if (looseWorkspaceMapKey(key) === wanted) return key;
  }
  return undefined;
}

/** Row stored for `workspacePath`, matching keys loosely. */
export function readWorkspaceMapRow<T>(
  map: Record<string, T> | null | undefined,
  workspacePath: string,
): T | undefined {
  const key = findWorkspaceMapKey(map as Record<string, unknown> | null | undefined, workspacePath);
  return key === undefined ? undefined : (map as Record<string, T>)[key];
}
