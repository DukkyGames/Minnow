/**
 * MRU helpers for the file-viewer empty state (recent workspace files).
 */

import { getWorkspacePath } from './workspace';
import {
  MAX_RECENT_VIEWER_FILES,
  getFilePanelState,
  patchFilePanelState,
  type RecentViewerFileEntry,
  type RecentViewerFilesByWorkspace,
} from './file-panel';
import { normalizeTreePath, isAncestorPath } from '../ui/file-tree-path';

/** Sentinel key when neither listing root nor workspace path is available. */
export const RECENT_VIEWER_DEFAULT_WORKSPACE_KEY = '__default__';

/**
 * Resolve the persistence key for a workspace root.
 * Pass the active listing root (desktop sandbox / worktree) when available;
 * otherwise falls back to the main workspace path.
 */
export function resolveRecentViewerWorkspaceKey(
  workspaceRootOverride?: string | null,
): string {
  const override = workspaceRootOverride?.trim();
  if (override) return override.replace(/\\/g, '/');
  const main = getWorkspacePath().trim();
  if (main) return main.replace(/\\/g, '/');
  return RECENT_VIEWER_DEFAULT_WORKSPACE_KEY;
}

/** Recent files for the active workspace (newest first). */
export function listRecentViewerFiles(
  workspaceRootOverride?: string | null,
): RecentViewerFileEntry[] {
  const key = resolveRecentViewerWorkspaceKey(workspaceRootOverride);
  const list = getFilePanelState().recentViewerFilesByWorkspace[key] ?? [];
  return list.map((e) => ({ path: e.path, openedAt: e.openedAt }));
}

/**
 * Record a workspace file open at the front of the MRU list.
 * Skips attachment virtual paths and empty paths.
 */
export function recordRecentViewerFile(
  path: string,
  options?: { workspaceRoot?: string | null; openedAt?: number },
): void {
  const norm = normalizeTreePath(path);
  if (!norm || norm === '.' || norm.startsWith('.minnow/attachments/')) return;

  const key = resolveRecentViewerWorkspaceKey(options?.workspaceRoot);
  const openedAt = options?.openedAt ?? Date.now();
  const map = { ...getFilePanelState().recentViewerFilesByWorkspace };
  const prev = map[key] ?? [];
  const next: RecentViewerFileEntry[] = [
    { path: norm, openedAt },
    ...prev.filter((e) => e.path !== norm),
  ].slice(0, MAX_RECENT_VIEWER_FILES);
  map[key] = next;
  patchFilePanelState({ recentViewerFilesByWorkspace: map });
}

/** Remove one path from the current workspace MRU (or a specific workspace key). */
export function removeRecentViewerFile(
  path: string,
  workspaceRootOverride?: string | null,
): void {
  const norm = normalizeTreePath(path);
  const key = resolveRecentViewerWorkspaceKey(workspaceRootOverride);
  const map = { ...getFilePanelState().recentViewerFilesByWorkspace };
  const prev = map[key];
  if (!prev?.length) return;
  const next = prev.filter((e) => e.path !== norm);
  if (next.length === prev.length) return;
  if (next.length === 0) delete map[key];
  else map[key] = next;
  patchFilePanelState({ recentViewerFilesByWorkspace: map });
}

/** Clear the MRU list for the current (or given) workspace. */
export function clearRecentViewerFiles(workspaceRootOverride?: string | null): void {
  const key = resolveRecentViewerWorkspaceKey(workspaceRootOverride);
  const map = { ...getFilePanelState().recentViewerFilesByWorkspace };
  if (!(key in map)) return;
  delete map[key];
  patchFilePanelState({ recentViewerFilesByWorkspace: map });
}

/** Drop recent entries under a deleted/renamed ancestor path. */
export function pruneRecentViewerFilesUnderAncestor(
  ancestorPath: string,
  workspaceRootOverride?: string | null,
): void {
  const ancestor = normalizeTreePath(ancestorPath);
  const key = resolveRecentViewerWorkspaceKey(workspaceRootOverride);
  const map = { ...getFilePanelState().recentViewerFilesByWorkspace };
  const prev = map[key];
  if (!prev?.length) return;
  const next = prev.filter((e) => !isAncestorPath(ancestor, e.path));
  if (next.length === prev.length) return;
  if (next.length === 0) delete map[key];
  else map[key] = next;
  patchFilePanelState({ recentViewerFilesByWorkspace: map });
}

/** Remap recent paths after a folder rename/move. */
export function remapRecentViewerFilesUnderAncestor(
  oldAncestor: string,
  newAncestor: string,
  workspaceRootOverride?: string | null,
): void {
  const oldNorm = normalizeTreePath(oldAncestor);
  const newNorm = normalizeTreePath(newAncestor);
  const key = resolveRecentViewerWorkspaceKey(workspaceRootOverride);
  const map = { ...getFilePanelState().recentViewerFilesByWorkspace };
  const prev = map[key];
  if (!prev?.length) return;
  const seen = new Set<string>();
  const next: RecentViewerFileEntry[] = [];
  for (const entry of prev) {
    let path = entry.path;
    if (path === oldNorm || isAncestorPath(oldNorm, path)) {
      path = normalizeTreePath(newNorm + path.slice(oldNorm.length));
    }
    if (seen.has(path)) continue;
    seen.add(path);
    next.push({ path, openedAt: entry.openedAt });
  }
  map[key] = next.slice(0, MAX_RECENT_VIEWER_FILES);
  patchFilePanelState({ recentViewerFilesByWorkspace: map });
}

/** Test helper: replace the entire recent map. */
export function setRecentViewerFilesByWorkspaceForTests(
  map: RecentViewerFilesByWorkspace,
): void {
  patchFilePanelState({ recentViewerFilesByWorkspace: map });
}
