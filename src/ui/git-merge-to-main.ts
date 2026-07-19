/**
 * Merge the current feature branch into trunk (main/master) from Source Control.
 */

import { confirmDirtyCheckout } from './git-checkout-confirm';
import {
  resolveTrunkBranchName,
  shouldShowMergeToMain,
  trunkBranchExists,
} from '../lib/git-trunk-branch';
import { gitBranches, gitCheckout, gitMerge, type GitOpResult } from '../state/git-api';

export interface MergeToMainContext {
  /** Branch checked out in the panel (source of the merge). */
  sourceBranch: string;
  /** Main workspace root where trunk is checked out for the merge. */
  mainWorkspaceCwd: string;
  /** Whether the panel cwd is the main workspace worktree. */
  onMainWorktree: boolean;
  localBranches: readonly string[];
  remoteBranches?: readonly string[];
}

/** Resolve trunk name and whether the merge-to-main button should be visible. */
export function mergeToMainButtonVisible(ctx: MergeToMainContext): boolean {
  const trunk = resolveTrunkBranchName(ctx.localBranches, ctx.remoteBranches ?? []);
  if (!trunkBranchExists(trunk, ctx.localBranches, ctx.remoteBranches ?? [])) {
    return false;
  }
  return shouldShowMergeToMain({
    currentBranch: ctx.sourceBranch,
    trunkBranch: trunk,
    onMainWorktree: ctx.onMainWorktree,
  });
}

/** Checkout trunk on the main workspace (when needed) and merge the source branch. */
export async function runMergeToMain(ctx: MergeToMainContext): Promise<GitOpResult> {
  const sourceBranch = ctx.sourceBranch.trim();
  const mainCwd = ctx.mainWorkspaceCwd.trim();

  if (!sourceBranch) {
    return { ok: false, error: 'Nothing to merge into main' };
  }
  if (!mainCwd) {
    return { ok: false, error: 'No workspace open' };
  }

  const branchesAtMain = await gitBranches(mainCwd);
  if (!branchesAtMain.ok) {
    return { ok: false, error: branchesAtMain.error ?? 'Could not read branches' };
  }

  const localAtMain = branchesAtMain.local ?? [];
  const remoteAtMain = branchesAtMain.remote ?? [];
  const trunk = resolveTrunkBranchName(localAtMain, remoteAtMain);

  if (sourceBranch === trunk) {
    return { ok: false, error: 'Nothing to merge into main' };
  }
  if (!trunkBranchExists(trunk, localAtMain, remoteAtMain)) {
    return { ok: false, error: 'Could not find main or master branch' };
  }

  const currentAtMain = (branchesAtMain.current ?? '').trim();
  if (currentAtMain !== trunk) {
    if (!(await confirmDirtyCheckout(mainCwd))) {
      return { ok: false, error: 'cancelled' };
    }
    const checkout = await gitCheckout({ branch: trunk, cwd: mainCwd });
    if (!checkout.ok) {
      return checkout;
    }
  }

  return gitMerge({ branch: sourceBranch, cwd: mainCwd });
}
