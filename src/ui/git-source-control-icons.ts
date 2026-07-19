/**
 * Raster icons for git source-control toolbar actions (pull, push, fetch, …).
 */

export type GitSourceControlAction =
  | 'pull'
  | 'push'
  | 'fetch'
  | 'merge'
  | 'rebase'
  | 'stash'
  | 'cherry-pick';

/** Public URL for each source-control action icon under /public/icons. */
export const GIT_SOURCE_CONTROL_ICON_SRC: Record<GitSourceControlAction, string> = {
  pull: '/icons/git-pull.png',
  push: '/icons/git-push.png',
  fetch: '/icons/git-fetch.png',
  merge: '/icons/git-merge.png',
  rebase: '/icons/git-rebase.png',
  stash: '/icons/git-stash.png',
  'cherry-pick': '/icons/git-cherry-pick.png',
};

/** Map visible button labels to icon action keys. */
const LABEL_TO_ACTION: Record<string, GitSourceControlAction> = {
  Pull: 'pull',
  Push: 'push',
  Fetch: 'fetch',
  'Fetch all': 'fetch',
  Merge: 'merge',
  'Merge to main': 'merge',
  Rebase: 'rebase',
  Stash: 'stash',
  'Cherry-pick': 'cherry-pick',
};

/** Resolve icon path from a toolbar button label. */
export function gitSourceControlIconSrc(label: string): string | undefined {
  const action = LABEL_TO_ACTION[label];
  return action ? GIT_SOURCE_CONTROL_ICON_SRC[action] : undefined;
}

/** Create a raster icon img for a source-control action button. */
export function createGitSourceControlIconImg(
  label: string,
  className = 'icon-img git-source-control-btn__icon',
): HTMLImageElement | null {
  const src = gitSourceControlIconSrc(label);
  if (!src) return null;

  const img = document.createElement('img');
  img.className = className;
  img.src = src;
  img.width = 14;
  img.height = 14;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  return img;
}

/** Append icon + label to a source-control action button. */
export function decorateGitSourceControlButton(
  btn: HTMLButtonElement,
  label: string,
): void {
  btn.classList.add('git-source-control-btn');
  btn.replaceChildren();

  const icon = createGitSourceControlIconImg(label);
  if (icon) btn.append(icon);

  const text = document.createElement('span');
  text.className = 'git-source-control-btn__label';
  text.textContent = label;
  btn.append(text);
}
