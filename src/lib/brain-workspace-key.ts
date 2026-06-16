/**
 * Derive Brain wiki workspace folder key from an absolute workspace root.
 * Mirrors server/brain/paths.js brainWorkspaceKeyFromPath (basename slug).
 */

/** Stable key for pages/workspaces/<key>/ — basename slug of the workspace path. */
export function brainWorkspaceKeyFromPath(workspacePath: string): string {
  const trimmed = workspacePath.trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  const segments = trimmed.split('/').filter(Boolean);
  const base = segments[segments.length - 1] ?? '';
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}
