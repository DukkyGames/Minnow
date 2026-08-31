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

/** Compact label for a worktree row in the git panel cwd dropdown. */
export function formatWorktreeOptionLabel(
  wt: ParsedWorktree,
  workspaceRoot: string,
): string {
  const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const normPath = wt.path.replace(/\\/g, '/').replace(/\/+$/, '');
  const isMain = normPath === normRoot;

  const branchLabel = wt.branch
    ? wt.branch
    : wt.detached
      ? '(detached)'
      : '(unknown)';

  if (isMain) {
    return `${branchLabel} — workspace`;
  }

  const leaf = normPath.split('/').pop() ?? normPath;
  return `${branchLabel} — ${leaf}`;
}

/** Minnow orchestration branches (board worktrees) — not user checkout targets. */
export function isMinnowBoardBranch(name: string): boolean {
  return name.startsWith('minnow/board/');
}

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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
 * User-facing worktree pickers: keep the workspace checkout, paths under it,
 * and `~/.minnow/worktrees/<thisRepoKey>/` slots. Drop other-repo Minnow slots
 * so a stale git-panel list cannot offer workspace B's boards after a switch.
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

  return worktrees.filter((wt) => {
    const p = posixPath(wt.path);
    const pKey = p.toLowerCase();
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
