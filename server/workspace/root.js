/**
 * User workspace root — directory where file/git/terminal tools operate.
 * Defaults to the Minnow app cwd when npm start is run; persisted in config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';
import { maybeAutoApplyWorkspaceProfile } from '../profiles/handlers.js';
import { realpathForBoundaryCheck } from './safe-path.js';

/** Directory where `npm start` was launched (Minnow install); overridable for packaged Electron. */
let APP_ROOT = path.resolve(process.cwd());

/** Max MRU workspace folders stored in config.json. */
export const MAX_RECENT_WORKSPACES = 10;

let workspaceRoot = APP_ROOT;

/** Set Minnow app root (e.g. Electron resources path). */
export function setAppRoot(dir) {
  APP_ROOT = path.resolve(dir);
}

/** Minnow install root (Vite, built-in skills/prompts). */
export function getAppRoot() {
  return APP_ROOT;
}

/** Active workspace for AI tools and file tree. */
export function getWorkspaceRoot() {
  return workspaceRoot;
}

/** Short label for UI (folder basename). */
export function workspaceLabel(absPath) {
  const base = path.basename(absPath);
  return base || absPath;
}

/**
 * Normalize an absolute path for dedupe keys (resolve + Windows case-fold).
 * @param {string} absPath
 * @returns {string}
 */
export function normalizeWorkspacePathKey(absPath) {
  const resolved = path.resolve(String(absPath).trim());
  if (process.platform === 'win32') {
    try {
      return realpathForBoundaryCheck(resolved).toLowerCase();
    } catch {
      return resolved.toLowerCase();
    }
  }
  return resolved;
}

/**
 * @param {object} meta
 * @returns {string[]}
 */
export function readRecentPathsFromMeta(meta) {
  const ws = meta?.workspace;
  if (!ws || typeof ws !== 'object') return [];
  const arr = ws.recentPaths;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => path.resolve(p.trim()));
}

/**
 * Dedupe by normalized key, preserve MRU order, cap length.
 * @param {string[]} paths
 * @returns {string[]}
 */
export function dedupeRecentPaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p || typeof p !== 'string' || !p.trim()) continue;
    const resolved = path.resolve(p.trim());
    const key = normalizeWorkspacePathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
    if (out.length >= MAX_RECENT_WORKSPACES) break;
  }
  return out;
}

/**
 * @param {object} meta
 * @returns {Promise<string[]>}
 */
async function loadRecentPathsFromDisk() {
  const meta = (await readConfigJson('config.json')) ?? {};
  return readRecentPathsFromMeta(meta);
}

/**
 * @param {string[]} recentPaths
 */
async function persistRecentPaths(recentPaths) {
  const meta = (await readConfigJson('config.json')) ?? {};
  const merged = mergeConfigMeta(meta, {
    workspace: { recentPaths: dedupeRecentPaths(recentPaths) },
  });
  await writeConfigJson('config.json', merged);
}

/**
 * Prepend a workspace path to MRU list and persist.
 * @param {string} absPath
 * @returns {Promise<string[]>}
 */
export async function touchRecentWorkspacePath(absPath) {
  const resolved = path.resolve(absPath);
  const existing = await loadRecentPathsFromDisk();
  const next = dedupeRecentPaths([resolved, ...existing]);
  await persistRecentPaths(next);
  return next;
}

/**
 * Remove one path from MRU list (does not change active workspace.path).
 * @param {string} absPath
 * @returns {Promise<string[]>}
 */
export async function removeRecentWorkspacePath(absPath) {
  const key = normalizeWorkspacePathKey(absPath);
  const existing = await loadRecentPathsFromDisk();
  const next = existing.filter((p) => normalizeWorkspacePathKey(p) !== key);
  await persistRecentPaths(next);
  return next;
}

/**
 * @param {string} absPath
 * @returns {Promise<boolean>}
 */
async function pathExistsAsDirectory(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build recent workspace rows for GET /api/workspace (includes current path).
 * @returns {Promise<Array<{ path: string, label: string, exists: boolean, isCurrent: boolean }>>}
 */
export async function buildRecentWorkspaceList() {
  const stored = await loadRecentPathsFromDisk();
  const current = getWorkspaceRoot();
  const currentKey = normalizeWorkspacePathKey(current);
  const allPaths = dedupeRecentPaths([current, ...stored]);
  const recent = [];
  for (const p of allPaths) {
    const exists = await pathExistsAsDirectory(p);
    recent.push({
      path: p,
      label: workspaceLabel(p),
      exists,
      isCurrent: normalizeWorkspacePathKey(p) === currentKey,
    });
  }
  return recent;
}

/**
 * Resolve and verify a workspace directory path.
 * @param {string} userPath
 * @returns {Promise<string>} absolute path
 */
export async function validateWorkspacePath(userPath) {
  if (!userPath || typeof userPath !== 'string' || !userPath.trim()) {
    throw new Error('Workspace path is required');
  }
  const resolved = path.resolve(userPath.trim());
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Workspace folder does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error('Workspace path must be a directory');
  }
  return resolved;
}

/**
 * Load persisted workspace from ~/.minnow/config.json (falls back to app root).
 */
export async function initWorkspaceRoot() {
  const meta = (await readConfigJson('config.json')) ?? {};
  const saved =
    meta.workspace &&
    typeof meta.workspace === 'object' &&
    typeof meta.workspace.path === 'string'
      ? meta.workspace.path
      : null;

  if (saved && saved.trim()) {
    try {
      workspaceRoot = await validateWorkspacePath(saved);
      return workspaceRoot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[workspace] Ignoring invalid saved path: ${message}`);
    }
  }

  workspaceRoot = getAppRoot();
  return workspaceRoot;
}

/**
 * Set workspace root in memory and persist to config.json.
 * @param {string} userPath
 * @returns {Promise<string>} absolute path
 */
export async function setWorkspaceRoot(userPath) {
  const previous = workspaceRoot;
  const resolved = await validateWorkspacePath(userPath);
  const changed =
    path.resolve(previous) !== path.resolve(resolved);
  workspaceRoot = resolved;
  if (changed) {
    try {
      const { shutdownAllLsp } = await import('../lsp/manager.js');
      shutdownAllLsp();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lsp] shutdown on workspace change failed: ${message}`);
    }
    try {
      const { onWorkspaceSwitched } = await import('../brain/code/cascade.js');
      void onWorkspaceSwitched(previous);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[brain] cascade on workspace switch failed: ${message}`);
    }
  }
  const meta = (await readConfigJson('config.json')) ?? {};
  const merged = mergeConfigMeta(meta, { workspace: { path: resolved } });
  await writeConfigJson('config.json', merged);
  await touchRecentWorkspacePath(resolved);
  try {
    await maybeAutoApplyWorkspaceProfile(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[profiles] workspace auto-apply skipped: ${message}`);
  }
  return resolved;
}

/** Current workspace info for API responses. */
export function getWorkspaceInfo() {
  return {
    path: workspaceRoot,
    label: workspaceLabel(workspaceRoot),
    isDefault: path.resolve(workspaceRoot) === getAppRoot(),
  };
}
