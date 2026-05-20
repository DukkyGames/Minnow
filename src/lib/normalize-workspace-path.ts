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
