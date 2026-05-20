/**
 * Client-side path normalization consistent with server resolveSafePath prefix rules.
 * Used only for approval UX; the server remains authoritative.
 */

/** Normalize a path for stable prefix comparison (slashes, drive letter casing on Windows). */
export function normalizePathForComparison(fsPath: string): string {
  let p = fsPath.trim().replace(/\\/g, '/');
  p = p.replace(/\/+/g, '/');
  if (/^[a-zA-Z]:\//.test(p)) {
    p = p.charAt(0).toUpperCase() + p.slice(1);
  }
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Resolve a user path against the workspace root the same way server.js does
 * (absolute paths stay absolute; relative paths join workspace).
 */
export function resolveUserPathLikeServer(userPath: string, workspaceRoot: string): string {
  const up = userPath.trim();
  const ws = workspaceRoot.trim();
  if (!ws) {
    return normalizePathForComparison(up.replace(/\\/g, '/'));
  }
  const wsNorm = ws.replace(/\\/g, '/');
  const isAbs =
    /^[a-zA-Z]:[\\/]/.test(up) || up.startsWith('/') || up.startsWith('\\');
  if (isAbs) {
    return normalizePathForComparison(up.replace(/\\/g, '/'));
  }
  const base = wsNorm.replace(/\/+$/, '');
  const rel = up.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const combined = `${base}/${rel}`.replace(/\/+/g, '/');
  return normalizePathForComparison(combined);
}

/** True when the resolved absolute-style path lies under the workspace root. */
export function isPathUnderWorkspace(userPath: string, workspaceRoot: string): boolean {
  if (!workspaceRoot.trim()) return true;
  const resolved = resolveUserPathLikeServer(userPath, workspaceRoot);
  const rootNorm = normalizePathForComparison(workspaceRoot);
  return resolved === rootNorm || resolved.startsWith(`${rootNorm}/`);
}
