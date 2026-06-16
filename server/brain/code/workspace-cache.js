/**
 * MIN-B11 — warm per-workspace SQLite code-index handles across workspace switches.
 * Opens cached ~/.minnow/brain/code/<key>.db files without forcing a full reindex.
 */

import { readConfigJson } from '../../config/store.js';
import { brainWorkspaceKeyFromPath } from '../paths.js';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';
import {
  getWorkspaceRoot,
  readRecentPathsFromMeta,
  dedupeRecentPaths,
} from '../../workspace/root.js';
import { getCodeDb } from './schema.js';

/** Max MRU workspace DB handles to warm on startup (excluding the active workspace). */
const STARTUP_WARM_LIMIT = 4;

/**
 * Open (or reuse) the code-index DB for one workspace key.
 * @param {string} workspaceKey
 */
export function warmCodeIndexForWorkspace(workspaceKey) {
  const key = String(workspaceKey ?? '').trim();
  if (!key) return null;
  return getCodeDb(key);
}

/**
 * Warm the code index for an absolute workspace directory path.
 * @param {string} absPath
 */
export function warmCodeIndexForPath(absPath) {
  const key = brainWorkspaceKeyFromPath(absPath);
  if (!key) return null;
  return warmCodeIndexForWorkspace(key);
}

/**
 * Warm SQLite handles for the active workspace plus recent MRU folders.
 * Does not reindex — callers rely on persisted indexes and lazy staleness checks.
 */
export async function warmRecentWorkspaceCodeIndexes() {
  const warmed = [];
  const current = getWorkspaceRoot();
  warmCodeIndexForPath(current);
  warmed.push(brainWorkspaceKeyFromPath(current));

  const meta = (await readConfigJson('config.json')) ?? {};
  const recent = dedupeRecentPaths(readRecentPathsFromMeta(meta));
  let extra = 0;
  for (const absPath of recent) {
    if (extra >= STARTUP_WARM_LIMIT) break;
    const key = brainWorkspaceKeyFromPath(absPath);
    if (!key || key === warmed[0]) continue;
    warmCodeIndexForWorkspace(key);
    warmed.push(key);
    extra += 1;
  }

  return { warmed: [...new Set(warmed.filter(Boolean))] };
}

/**
 * Workspace-switch hook: open the new workspace DB immediately so the first query
 * does not pay SQLite open + schema init on the critical path.
 */
export function warmCodeIndexOnWorkspaceSwitch() {
  const root = getEffectiveWorkspaceRoot();
  const key = brainWorkspaceKeyFromPath(root);
  if (!key) return null;
  return warmCodeIndexForWorkspace(key);
}
