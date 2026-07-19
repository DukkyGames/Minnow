import { appAlert, appConfirm, appPrompt } from './app-dialog';
/**
 * Confirm checkout when the working tree has uncommitted changes.
 */

import { gitStatus } from '../state/git-api';

/** Returns true when checkout should proceed (clean tree or user confirmed). */
export async function confirmDirtyCheckout(cwd?: string): Promise<boolean> {
  const status = await gitStatus(cwd);
  if (!status.ok) return true;

  const dirty =
    (status.staged?.length ?? 0) +
      (status.unstaged?.length ?? 0) +
      (status.untracked?.length ?? 0) >
    0;

  if (!dirty) return true;
  return await appConfirm('Working tree has uncommitted changes. Checkout anyway?');
}
