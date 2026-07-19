/**
 * Resolve the repository trunk branch name (main/master) for merge-to-main flows.
 */

/** Prefer `main`, then `master`, otherwise default to `main`. */
export function resolveTrunkBranchName(localBranches: readonly string[]): string {
  const names = new Set(localBranches);
  if (names.has('main')) return 'main';
  if (names.has('master')) return 'master';
  return 'main';
}

/** Whether Source Control should show a Merge to main action. */
export function shouldShowMergeToMain(input: {
  currentBranch: string;
  trunkBranch: string;
  onMainWorktree: boolean;
}): boolean {
  const branch = input.currentBranch.trim();
  if (!branch) return false;

  const onTrunk = branch === input.trunkBranch;
  if (onTrunk) return false;

  // Feature branch on main or secondary worktree.
  return true;
}
