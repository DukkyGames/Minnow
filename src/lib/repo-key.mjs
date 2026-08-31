/**
 * Per-repo worktree directory key (`<basename>-<sha1[0:8]>`).
 *
 * Shared by the server (`server/worktree/paths.js`) and user-facing worktree
 * pickers so a slot under `~/.minnow/worktrees/<repoKey>/` can be attributed
 * to this workspace without a new API. The server still realpath-canonicalizes
 * before hashing; the client hashes the path it already has.
 */

import { sanitizePathSegment } from './sanitize-path-segment.mjs';
import { sha1Hex } from './sha1.mjs';

/**
 * Mirror of `normalizeWorkspacePathKey` case rules without Node realpath.
 * Windows (or a drive-letter path) lowercases; POSIX keeps case.
 *
 * @param {string} absPath
 * @returns {string}
 */
export function normalizePathForRepoKey(absPath) {
  let resolved = String(absPath ?? '').trim();
  if (!resolved) return '';
  const win32 =
    (typeof process !== 'undefined' && process.platform === 'win32') ||
    /^[a-zA-Z]:[\\/]/.test(resolved);
  if (win32) resolved = resolved.toLowerCase();
  return resolved;
}

/**
 * Repo key from an already-normalized absolute path (slash style as hashed).
 *
 * @param {string} normalizedAbsPath
 * @returns {string}
 */
export function repoKeyFromNormalizedPath(normalizedAbsPath) {
  const raw = String(normalizedAbsPath ?? '');
  const posix = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  const base = sanitizePathSegment(posix.split('/').filter(Boolean).pop() || 'repo');
  const hash = sha1Hex(raw).slice(0, 8);
  return `${base}-${hash}`;
}

/**
 * Client-side repo key for a workspace root. Same shape as
 * `repoKeyForWorkspace` when the path is already canonical.
 *
 * @param {string} workspacePath
 * @returns {string}
 */
export function repoKeyFromWorkspacePath(workspacePath) {
  return repoKeyFromNormalizedPath(normalizePathForRepoKey(workspacePath));
}
