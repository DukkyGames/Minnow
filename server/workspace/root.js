/**
 * User workspace root — directory where file/git/terminal tools operate.
 * Defaults to the Minnow app cwd when npm start is run; persisted in config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';

/** Directory where `npm start` was launched (Minnow install). */
const APP_ROOT = path.resolve(process.cwd());

let workspaceRoot = APP_ROOT;

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

  workspaceRoot = APP_ROOT;
  return workspaceRoot;
}

/**
 * Set workspace root in memory and persist to config.json.
 * @param {string} userPath
 * @returns {Promise<string>} absolute path
 */
export async function setWorkspaceRoot(userPath) {
  const resolved = await validateWorkspacePath(userPath);
  workspaceRoot = resolved;
  const meta = (await readConfigJson('config.json')) ?? {};
  const merged = mergeConfigMeta(meta, { workspace: { path: resolved } });
  await writeConfigJson('config.json', merged);
  return resolved;
}

/** Current workspace info for API responses. */
export function getWorkspaceInfo() {
  return {
    path: workspaceRoot,
    label: workspaceLabel(workspaceRoot),
    isDefault: path.resolve(workspaceRoot) === APP_ROOT,
  };
}
