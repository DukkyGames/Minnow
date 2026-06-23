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
