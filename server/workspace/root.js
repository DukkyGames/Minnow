/**
 * User workspace root — directory where file/git/terminal tools operate.
 * Defaults to the Minnow app cwd when npm start is run; persisted in config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';
import { maybeAutoApplyWorkspaceProfile } from '../profiles/handlers.js';
import { getMinnowHome } from '../config/home.js';
import { realpathForBoundaryCheck } from './safe-path.js';

/** UI label for the Minnow-owned scratch sandbox (~/.minnow/workspace). */
export const SCRATCH_WORKSPACE_LABEL = 'Scratch';

const SCRATCH_DIR_NAME = 'workspace';

const SCRATCH_README_BODY = `# Minnow Scratch Workspace

This directory is Minnow's Scratch sandbox — attachments, notes, and session artifacts when no project folder is open.

- Files here stay separate from your active Code project workspace unless tools are explicitly pointed elsewhere.
- Do not store secrets here if you sync or share ~/.minnow.
`;

/** Directory where `npm start` was launched (Minnow install); overridable for packaged Electron. */
let APP_ROOT = path.resolve(process.cwd());

/** Max MRU workspace folders stored in config.json. */
export const MAX_RECENT_WORKSPACES = 10;

let workspaceRoot = APP_ROOT;
/** False until the user explicitly picks or creates a workspace folder. */
let workspaceUserChosen = false;

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

/** Whether the user has explicitly chosen a workspace (welcome / picker / PUT). */
export function isWorkspaceUserChosen() {
  return workspaceUserChosen;
}

/**
 * Bundled Minnow install roots are not real project folders (packaged app.asar, etc.).
 * @param {string} absPath
 * @returns {boolean}
 */
export function isPlaceholderWorkspacePath(absPath) {
  const resolved = path.resolve(String(absPath).trim());
  const appRoot = path.resolve(getAppRoot());
  if (resolved === appRoot) {
    return true;
  }
  const base = path.basename(resolved).toLowerCase();
  if (base === 'app.asar') {
    return true;
  }
  const stripAsar = (p) => p.replace(/\.asar$/i, '');
  if (stripAsar(resolved) === stripAsar(appRoot)) {
    return true;
  }
  return false;
}

/** Absolute path to the Scratch sandbox (~/.minnow/workspace). */
export function getScratchWorkspacePath() {
  return path.join(getMinnowHome(), SCRATCH_DIR_NAME);
}

/** Create the Scratch directory (and README on first run). */
async function ensureScratchWorkspaceDir() {
  const root = getScratchWorkspacePath();
  await fs.mkdir(root, { recursive: true });

  const readmePath = path.join(root, 'README.md');
  try {
    await fs.access(readmePath);
  } catch {
    await fs.writeFile(readmePath, SCRATCH_README_BODY, 'utf8');
  }

  return root;
}

/** True when absPath is the registered Scratch workspace root. */
export function isScratchWorkspacePath(absPath) {
  const resolved = path.resolve(String(absPath).trim());
  const scratch = path.resolve(getScratchWorkspacePath());
  return normalizeWorkspacePathKey(resolved) === normalizeWorkspacePathKey(scratch);
}

/** Short label for UI (folder basename, or Scratch for the sandbox). */
export function workspaceLabel(absPath) {
  if (isScratchWorkspacePath(absPath)) {
    return SCRATCH_WORKSPACE_LABEL;
  }
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
  if (process.platform === 'darwin') {
    try {
      return realpathForBoundaryCheck(resolved);
    } catch {
      return resolved;
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
 * @param {object} meta config.json root
 * @param {string | null} savedPath
 * @returns {boolean}
 */
function resolveWorkspaceUserChosenFromMeta(meta, savedPath) {
  const ws = meta?.workspace;
  if (ws && typeof ws === 'object' && typeof ws.userChosen === 'boolean') {
    return ws.userChosen;
  }
  if (savedPath && savedPath.trim()) {
    const resolved = path.resolve(savedPath.trim());
    if (!isPlaceholderWorkspacePath(resolved)) {
      return true;
    }
  }
  return false;
}

/**
 * Ensure Scratch exists, is registered in config, and appears in workspace MRU.
 * @returns {Promise<string>} absolute Scratch path
 */
export async function ensureScratchWorkspaceRegistered() {
  const scratchPath = await ensureScratchWorkspaceDir();
  const meta = (await readConfigJson('config.json')) ?? {};
  const scratchKey = normalizeWorkspacePathKey(scratchPath);
  const existingScratch =
    meta.workspace &&
    typeof meta.workspace === 'object' &&
    typeof meta.workspace.scratchPath === 'string'
      ? meta.workspace.scratchPath.trim()
      : '';
  if (
    !existingScratch ||
    normalizeWorkspacePathKey(existingScratch) !== scratchKey
  ) {
    const merged = mergeConfigMeta(meta, {
      workspace: { scratchPath: scratchPath },
    });
    await writeConfigJson('config.json', merged);
  }
  await touchRecentWorkspacePath(scratchPath);
  return scratchPath;
}

/**
 * Load persisted workspace from ~/.minnow/config.json (falls back to app root).
 */
export async function initWorkspaceRoot() {
  await ensureScratchWorkspaceRegistered();
  const meta = (await readConfigJson('config.json')) ?? {};
  const saved =
    meta.workspace &&
    typeof meta.workspace === 'object' &&
    typeof meta.workspace.path === 'string'
      ? meta.workspace.path
      : null;

  workspaceUserChosen = resolveWorkspaceUserChosenFromMeta(meta, saved);

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
  workspaceUserChosen = false;
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
  workspaceUserChosen = true;
  const meta = (await readConfigJson('config.json')) ?? {};
  const merged = mergeConfigMeta(meta, { workspace: { path: resolved, userChosen: true } });
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
  const placeholder = isPlaceholderWorkspacePath(workspaceRoot);
  return {
    path: workspaceRoot,
    label: workspaceLabel(workspaceRoot),
    isDefault: !workspaceUserChosen || placeholder,
    userChosen: workspaceUserChosen,
    scratchPath: getScratchWorkspacePath(),
  };
}
