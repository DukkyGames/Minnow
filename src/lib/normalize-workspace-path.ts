/**
 * Normalize workspace directory paths for stable comparison and map keys.
 * Mirrors server/config/validators.js (Windows drive casing, slashes).
 */

import { normalizePathForComparison } from '../tools/workspace-path-guard';

/** Normalize an absolute workspace root path for storage and equality checks. */
export function normalizeWorkspacePath(fsPath: string): string {
  if (!fsPath || typeof fsPath !== 'string') return '';
  return normalizePathForComparison(fsPath.trim());
}

/** True when both strings name the same folder after slash and drive normalization. */
export function workspacePathsEqual(a: string, b: string): boolean {
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  return Boolean(left) && left === right;
}
