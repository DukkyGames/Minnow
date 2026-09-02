export const GIT_COMMIT_DIFF_WORD_WRAP_KEY = 'minnow.gitCommitDiffWordWrap';

/** Read wrap preference; default on so long lines stay comparable without sideways scroll. */
export function getGitCommitDiffWordWrap(): boolean {
  try {
    return localStorage.getItem(GIT_COMMIT_DIFF_WORD_WRAP_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Persist wrap preference (`'1'` / `'0'`). */
export function setGitCommitDiffWordWrap(enabled: boolean): void {
  try {
    localStorage.setItem(GIT_COMMIT_DIFF_WORD_WRAP_KEY, enabled ? '1' : '0');
  } catch {
  }
}
