/**
 * Chats workspace paths under MINNOW_HOME (~/.minnow/chats).
 * Sandboxed storage for chat-scoped files, separate from the Code workspace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import {
  getWorkspaceRoot,
  normalizeWorkspacePathKey,
} from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';

const CHATS_DIR_NAME = 'chats';

const README_BODY = `# Minnow Chats Workspace

This directory is a sandbox for chat-scoped files (attachments, exports, and session artifacts).

- Files here stay separate from your active Code workspace unless tools are explicitly pointed at this path.
- The server only allows tool \`workspaceRoot\` overrides for your Code workspace or this chats folder.
- Do not store secrets here if you sync or share ~/.minnow.
`;

/** Absolute path to ~/.minnow/chats (created on bootstrap). */
export function getChatsWorkspacePath() {
  return path.join(getMinnowHome(), CHATS_DIR_NAME);
}

/**
 * Create the chats workspace directory and optional README on first run.
 * @returns {Promise<string>} absolute chats workspace path
 */
export async function ensureChatsWorkspace() {
  const root = getChatsWorkspacePath();
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
 * True when rootPath is the active Code workspace or the chats sandbox.
 * @param {string} rootPath
 */
export function isAllowedWorkspaceRoot(rootPath) {
  if (!rootPath || typeof rootPath !== 'string' || !rootPath.trim()) {
    return false;
  }
  const resolved = path.resolve(rootPath.trim());
  const key = normalizeWorkspacePathKey(resolved);
  const codeKey = normalizeWorkspacePathKey(getWorkspaceRoot());
  const chatsKey = normalizeWorkspacePathKey(getChatsWorkspacePath());
  return key === codeKey || key === chatsKey;
}

/**
 * Validate an allowed workspace root exists as a directory.
 * @param {string} rootPath
 * @returns {Promise<string>} resolved absolute path
 */
export async function validateAllowedWorkspaceRoot(rootPath) {
  if (!isAllowedWorkspaceRoot(rootPath)) {
    throw new Error('workspaceRoot is not in the allowlist (Code workspace or chats workspace)');
  }
  const resolved = path.resolve(String(rootPath).trim());
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`workspaceRoot does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error('workspaceRoot must be a directory');
  }
  return resolved;
}

/**
 * Resolve a user path under the chats workspace root (blocks traversal escapes).
 * @param {string | null | undefined} userPath Empty → chats root.
 * @returns {string}
 */
export function resolveSafeChatsPath(userPath) {
  const root = getChatsWorkspacePath();
  const trimmed = typeof userPath === 'string' ? userPath.trim() : '';
  const resolved = trimmed
    ? path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(root, trimmed)
    : root;

  if (!isResolvedPathUnderRoot(resolved, root)) {
    throw new Error('Path resolves outside the chats workspace');
  }

  return resolved;
}

/**
 * Workspace-relative path from the chats root (forward slashes).
 * @param {string} absPath
 */
export function toChatsRelativePath(absPath) {
  const root = getChatsWorkspacePath();
  const rel = path.relative(root, absPath);
  if (rel === '') return '.';
  return rel.replace(/\\/g, '/');
}
