/**
 * Uicons glyphs for git source-control toolbar actions (pull, push, fetch, …).
 */

import { createIcon, type IconName } from './icon';

export type GitSourceControlAction =
  | 'pull'
  | 'push'
  | 'fetch'
  | 'merge'
  | 'rebase'
  | 'stash'
  | 'cherry-pick';

const ACTION_TO_ICON: Record<GitSourceControlAction, IconName> = {
  pull: 'gitPull',
  push: 'gitPush',
  fetch: 'gitFetch',
  merge: 'gitMerge',
  rebase: 'gitRebase',
  stash: 'gitStash',
  'cherry-pick': 'gitCherryPick',
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

/** Resolve semantic icon name from a toolbar button label. */
export function gitSourceControlIconName(label: string): IconName | undefined {
  const action = LABEL_TO_ACTION[label];
  return action ? ACTION_TO_ICON[action] : undefined;
}

/** @deprecated Use gitSourceControlIconName. */
export function gitSourceControlIconSrc(label: string): string | undefined {
  return gitSourceControlIconName(label);
}

/** Create a Uicons icon for a source-control action button. */
export function createGitSourceControlIconImg(
  label: string,
  className = 'icon-svg git-source-control-btn__icon',
): HTMLElement | null {
  const name = gitSourceControlIconName(label);
  if (!name) return null;
  // 12px matches the compact git-panel action row (11px labels).
  return createIcon(name, { size: 12, className });
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
