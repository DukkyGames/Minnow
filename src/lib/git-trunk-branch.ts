/**
 * Resolve the repository trunk branch name (main/master) for merge-to-main flows.
 */

export interface TrunkBranchLists {
  localBranches: readonly string[];
  remoteBranches?: readonly string[];
}

/** Strip `remotes/<remote>/<branch>` to a short branch name when possible. */
function remoteBranchShortName(ref: string): string | null {
  const trimmed = ref.trim();
  const headMatch = trimmed.match(/^remotes\/[^/]+\/HEAD -> origin\/(.+)$/);
  if (headMatch?.[1]) return headMatch[1].trim();

  const match = trimmed.match(/^remotes\/[^/]+\/(.+)$/);
  if (!match?.[1] || match[1] === 'HEAD') return null;
  return match[1].trim();
}

function collectRemoteShortNames(remoteBranches: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const ref of remoteBranches) {
    const short = remoteBranchShortName(ref);
    if (short) names.add(short);
  }
  return names;
}

/** Prefer `main`, then `master`, using local names first, then remotes. */
export function resolveTrunkBranchName(
  localBranches: readonly string[],
  remoteBranches: readonly string[] = [],
): string {
  const local = new Set(localBranches);
  if (local.has('main')) return 'main';
  if (local.has('master')) return 'master';

  const remote = collectRemoteShortNames(remoteBranches);
  if (remote.has('main')) return 'main';
  if (remote.has('master')) return 'master';

  return 'main';
}

/** Whether the resolved trunk branch exists locally or on a remote. */
export function trunkBranchExists(
  trunk: string,
  localBranches: readonly string[],
  remoteBranches: readonly string[] = [],
): boolean {
  if (localBranches.includes(trunk)) return true;
  return collectRemoteShortNames(remoteBranches).has(trunk);
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
