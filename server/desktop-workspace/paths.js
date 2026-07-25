/**
 * Desktop workspace paths under MINNOW_HOME (~/.minnow/workspace).
 * Sandboxed storage for MinnowOS desktop chat files, separate from Code and chats.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';
import { getMinnowHome } from '../config/home.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';
import { touchRecentWorkspacePath, validateWorkspacePath } from '../workspace/root.js';

const DESKTOP_DIR_NAME = 'workspace';

const README_BODY = `# Minnow Desktop Workspace

This directory is the sandbox for MinnowOS desktop chat — attachments, notes, HTML previews, and session artifacts.

- Files here stay separate from your active Code project workspace unless tools are explicitly pointed elsewhere.
- Open the **Files**, **Browser**, and **Preview** tabs on the desktop to browse and edit this folder.
- Do not store secrets here if you sync or share ~/.minnow.
`;

/** Default sandbox under ~/.minnow/workspace (created on bootstrap). */
function getDefaultDesktopWorkspacePath() {
  return path.join(getMinnowHome(), DESKTOP_DIR_NAME);
}

/** Active desktop chat workspace root (lazy — set on init or first read). */
let desktopWorkspaceRoot = null;

/** Reset in-memory desktop workspace path (tests only). */
export function resetDesktopWorkspacePathForTests() {
  desktopWorkspaceRoot = null;
}

/** Absolute path to the default desktop sandbox directory. */
export function getDefaultDesktopSandboxPath() {
  return getDefaultDesktopWorkspacePath();
}

/** Absolute path to the active desktop chat workspace. */
export function getDesktopWorkspacePath() {
  return desktopWorkspaceRoot ?? getDefaultDesktopWorkspacePath();
}

/**
 * Load persisted desktop workspace from ~/.minnow/config.json (falls back to sandbox).
 * @returns {Promise<string>}
 */
export async function initDesktopWorkspacePath() {
  const meta = (await readConfigJson('config.json')) ?? {};
  const saved =
    meta.desktopWorkspace &&
    typeof meta.desktopWorkspace === 'object' &&
    typeof meta.desktopWorkspace.path === 'string'
      ? meta.desktopWorkspace.path
      : null;

  if (saved && saved.trim()) {
    try {
      desktopWorkspaceRoot = await validateWorkspacePath(saved);
      return desktopWorkspaceRoot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[desktop-workspace] Ignoring invalid saved path: ${message}`);
    }
  }

  desktopWorkspaceRoot = getDefaultDesktopWorkspacePath();
  return desktopWorkspaceRoot;
}

/**
 * Set desktop chat workspace root in memory and persist to config.json.
 * @param {string} userPath
 * @returns {Promise<string>} absolute path
 */
export async function setDesktopWorkspacePath(userPath) {
  const resolved = await validateWorkspacePath(userPath);
  desktopWorkspaceRoot = resolved;
  const meta = (await readConfigJson('config.json')) ?? {};
  const merged = mergeConfigMeta(meta, {
    desktopWorkspace: { path: resolved },
  });
  await writeConfigJson('config.json', merged);
  await touchRecentWorkspacePath(resolved);
  return resolved;
}

/**
 * Create the desktop workspace directory and optional README on first run.
 * @returns {Promise<string>} absolute desktop workspace path
 */
export async function ensureDesktopWorkspace() {
  const root = getDefaultDesktopWorkspacePath();
  await fs.mkdir(root, { recursive: true });

  const readmePath = path.join(root, 'README.md');
  try {
    await fs.access(readmePath);
  } catch {
    await fs.writeFile(readmePath, README_BODY, 'utf8');
  }

  return root;
}

/**
 * Resolve a user path under the desktop workspace root (blocks traversal escapes).
 * @param {string | null | undefined} userPath Empty → desktop root.
 * @returns {string}
 */
export function resolveSafeDesktopPath(userPath) {
  const root = getDesktopWorkspacePath();
  const trimmed = typeof userPath === 'string' ? userPath.trim() : '';
  const resolved = trimmed
    ? path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(root, trimmed)
    : root;

  if (!isResolvedPathUnderRoot(resolved, root)) {
    throw new Error('Path resolves outside the desktop workspace');
  }

  return resolved;
}

/**
 * Workspace-relative path from the desktop root (forward slashes).
 * @param {string} absPath
 */
export function toDesktopRelativePath(absPath) {
  const root = getDesktopWorkspacePath();
  const rel = path.relative(root, absPath);
  if (rel === '') return '.';
  return rel.replace(/\\/g, '/');
}
