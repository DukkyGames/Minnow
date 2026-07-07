/**
 * Desktop workspace paths under MINNOW_HOME (~/.minnow/workspace).
 * Sandboxed storage for MinnowOS desktop chat files, separate from Code and chats.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';

const DESKTOP_DIR_NAME = 'workspace';

const README_BODY = `# Minnow Desktop Workspace

This directory is the sandbox for MinnowOS desktop chat — attachments, notes, HTML previews, and session artifacts.

- Files here stay separate from your active Code project workspace unless tools are explicitly pointed elsewhere.
- Open the **Files**, **Browser**, and **Preview** tabs on the desktop to browse and edit this folder.
- Do not store secrets here if you sync or share ~/.minnow.
`;

/** Absolute path to ~/.minnow/workspace (created on bootstrap). */
export function getDesktopWorkspacePath() {
  return path.join(getMinnowHome(), DESKTOP_DIR_NAME);
}

/**
 * Create the desktop workspace directory and optional README on first run.
 * @returns {Promise<string>} absolute desktop workspace path
 */
export async function ensureDesktopWorkspace() {
  const root = getDesktopWorkspacePath();
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
