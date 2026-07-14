/**
 * Client hooks for /git-setup — programmatic baseline .gitignore before the model runs.
 */

import { ensureBaselineGitignore } from '../state/baseline-gitignore';

export const GIT_SETUP_SKILL_ID = 'git-setup';

/**
 * Ensure baseline .gitignore exists when starting a git-setup skill turn.
 * Safe to call on every turn; never overwrites an existing file.
 */
export async function prepareGitSetupTurn(workspaceRoot?: string): Promise<void> {
  await ensureBaselineGitignore(workspaceRoot);
}
