import { repoKeyFromWorkspacePath } from './repo-key.mjs';

/**
 * Parse `git worktree list --porcelain` output into structured entries (MIN-198 P3).
 */

export interface ParsedWorktree {
  path: string;
  head: string;
  /** Short branch name when checked out on a branch. */
  branch?: string;
  detached: boolean;
  bare?: boolean;
}

/** Parse porcelain blocks emitted by `git worktree list --porcelain`. */
export function parseWorktreeListPorcelain(output: string): ParsedWorktree[] {
  const worktrees: ParsedWorktree[] = [];
  let current: Partial<ParsedWorktree> | null = null;

  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith('worktree ')) {
      if (current?.path) {
        worktrees.push(finishWorktreeEntry(current));
      }
      current = { path: line.slice('worktree '.length), detached: false };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    }
  }

  if (current?.path) {
    worktrees.push(finishWorktreeEntry(current));
  }

  return worktrees;
}

function finishWorktreeEntry(entry: Partial<ParsedWorktree>): ParsedWorktree {
  return {
    path: entry.path ?? '',
    head: entry.head ?? '',
    branch: entry.branch,
    detached: entry.detached === true,
    bare: entry.bare,
  };
}

/**
 * Normalize a worktree/workspace path for equality checks.
 * Mirrors `normalizePathForComparison` (slashes + Windows drive casing) without
 * importing the tools layer into this shared parse helper.
 */
export function normalizeWorktreePath(p: string): string {
  let path = String(p ?? '').trim().replace(/\\/g, '/');
  path = path.replace(/\/+/g, '/');
  if (/^[a-zA-Z]:\//.test(path)) {
    path = path.charAt(0).toUpperCase() + path.slice(1);
  }
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

/** True when two worktree paths refer to the same directory (MIN-780). */
export function worktreePathsEqual(a: string, b: string): boolean {
  const na = normalizeWorktreePath(a);
  const nb = normalizeWorktreePath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Windows paths are case-insensitive (git porcelain vs folder-picker casing).
  if (/^[a-zA-Z]:\//.test(na) || /^[a-zA-Z]:\//.test(nb)) {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return false;
}

/**
 * Git’s principal checkout — always the first `git worktree list --porcelain`
 * entry (same rule as server `resolveMainWorktreePath`).
 */
export function getPrincipalWorktree(
  worktrees: readonly ParsedWorktree[],
): ParsedWorktree | undefined {
  return worktrees[0];
}

/** True when `worktreePath` is the repo’s principal checkout. */
export function isPrincipalWorktreePath(
  worktreePath: string,
  worktrees: readonly ParsedWorktree[],
): boolean {
  const principal = getPrincipalWorktree(worktrees);
  if (!principal?.path) return false;
  return worktreePathsEqual(worktreePath, principal.path);
}

export interface FormatWorktreeOptionLabelOptions {
  /** Absolute path of the git principal worktree (first porcelain entry). */
  principalPath?: string;
}

/** Compact label for a worktree row in the git panel cwd dropdown. */
export function formatWorktreeOptionLabel(
  wt: ParsedWorktree,
  workspaceRoot: string,
  options?: FormatWorktreeOptionLabelOptions,
): string {
  const branchLabel = wt.branch
    ? wt.branch
    : wt.detached
      ? '(detached)'
      : '(unknown)';

  // Code workspace folder — may itself be a linked worktree.
  if (worktreePathsEqual(wt.path, workspaceRoot)) {
    return `${branchLabel} — workspace`;
  }

  // Git principal checkout when the Code workspace is a different folder (MIN-780).
  if (options?.principalPath && worktreePathsEqual(wt.path, options.principalPath)) {
    return `${branchLabel} — main worktree`;
  }

  const normPath = normalizeWorktreePath(wt.path);
  const leaf = normPath.split('/').pop() ?? normPath;
  return `${branchLabel} — ${leaf}`;
}

/** Minnow orchestration branches (board worktrees) — not user checkout targets. */
export function isMinnowBoardBranch(name: string): boolean {
  return name.startsWith('minnow/board/');
}

function normalizePathForCompare(p: string): string {
  return normalizeWorktreePath(p).toLowerCase();
}

/** Branches checked out in a worktree other than `mainWorkspaceRoot`. */
export function branchesLockedToOtherWorktrees(
  worktrees: ParsedWorktree[],
  mainWorkspaceRoot: string,
): Set<string> {
  const main = normalizePathForCompare(mainWorkspaceRoot);
  const locked = new Set<string>();
  for (const wt of worktrees) {
    const branch = wt.branch?.trim();
    if (!branch) continue;
    if (normalizePathForCompare(wt.path) === main) continue;
    locked.add(branch);
  }
  return locked;
}

/** Local branches suitable for user-facing checkout pickers. */
export function filterUserFacingBranches(
  local: string[],
  lockedElsewhere?: Iterable<string>,
): string[] {
  const locked = new Set(lockedElsewhere ?? []);
  return local.filter((b) => !isMinnowBoardBranch(b) && !locked.has(b));
}

function posixPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Repo key segment under `…/worktrees/<repoKey>/…`, or null when this is not
 * a Minnow-managed slot. The segment name is exactly `worktrees` — not the
 * repo-local `.worktrees` directory.
 */
export function minnowWorktreesRepoKeyFromPath(worktreePath: string): string | null {
  const parts = posixPath(worktreePath).split('/');
  const index = parts.findIndex((segment) => segment === 'worktrees');
  if (index === -1 || index === parts.length - 1) return null;
  const key = parts[index + 1];
  return key || null;
}

/**
 * User-facing worktree pickers: keep the git principal checkout, the workspace
 * checkout, paths under it, and `~/.minnow/worktrees/<thisRepoKey>/` slots.
 * Drop other-repo Minnow slots so a stale git-panel list cannot offer
 * workspace B's boards after a switch.
 */
export function filterUserFacingWorktrees(
  worktrees: ParsedWorktree[],
  workspaceRoot: string,
): ParsedWorktree[] {
  const root = posixPath(workspaceRoot);
  if (!root) return worktrees;
  const rootKey = root.toLowerCase();
  const expectedKey = repoKeyFromWorkspacePath(root);
  const expectedBase = expectedKey.replace(/-[0-9a-f]{8}$/i, '');
  // First porcelain entry is always the principal — never hide it (MIN-780).
  const principalKey = worktrees[0]?.path
    ? posixPath(worktrees[0].path).toLowerCase()
    : '';

  return worktrees.filter((wt, index) => {
    if (index === 0) return true;
    const p = posixPath(wt.path);
    const pKey = p.toLowerCase();
    if (principalKey && pKey === principalKey) return true;
    if (pKey === rootKey || pKey.startsWith(`${rootKey}/`)) return true;
    const slotKey = minnowWorktreesRepoKeyFromPath(p);
    if (slotKey == null) return true;
    if (slotKey === expectedKey) return true;
    const slotBase = slotKey.replace(/-[0-9a-f]{8}$/i, '');
    // Same folder name, hash may differ (realpath vs UI path). Other basenames
    // are a different workspace's slots — hide them.
    return slotBase === expectedBase;
  });
}
