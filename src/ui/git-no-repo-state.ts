import '../styles/git-no-repo.css';
import { iconHtml } from './icon';
import {
  isGitSetupBackgroundBusy,
  startGitSetupBackgroundChat,
} from '../chat/git-setup-background';

const DEFAULT_HINT =
  'This workspace is not tracked with git. Initialize to see branches, changes, and commit history.';

/** True when git status failed because the workspace root is not a repository. */
export function isMissingGitRepositoryError(message?: string): boolean {
  return Boolean(message && /not a git repository/i.test(message));
}

function applySetupButtonBusy(action: HTMLButtonElement, busy: boolean): void {
  action.disabled = busy;
  action.textContent = busy ? 'Setting up…' : 'Set up git';
}

/** Informational block with optional Set up git CTA. */
export function renderGitNoRepositoryState(
  host: HTMLElement,
  options?: { hint?: string; onSetupGit?: () => void },
): void {
  host.replaceChildren();

  const block = document.createElement('div');
  block.className = 'git-no-repo';
  block.setAttribute('role', 'status');

  const icon = document.createElement('div');
  icon.className = 'git-no-repo__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = iconHtml('gitGraph');

  const title = document.createElement('p');
  title.className = 'git-no-repo__title';
  title.textContent = 'No git repository';

  const hint = document.createElement('p');
  hint.className = 'git-no-repo__hint';
  hint.textContent = options?.hint ?? DEFAULT_HINT;

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'git-no-repo__btn';
  applySetupButtonBusy(action, !options?.onSetupGit && isGitSetupBackgroundBusy());
  action.addEventListener('click', () => {
    if (options?.onSetupGit) {
      options.onSetupGit();
      return;
    }
    void handleDefaultSetupGitClick(action);
  });

  block.append(icon, title, hint, action);
  host.appendChild(block);
}

/** Stay on the current surface; run /git-setup in a background chat. */
async function handleDefaultSetupGitClick(action: HTMLButtonElement): Promise<void> {
  if (action.disabled) return;
  applySetupButtonBusy(action, true);
  const result = await startGitSetupBackgroundChat();
  if (!result.ok) {
    applySetupButtonBusy(action, false);
    return;
  }
  if (!isGitSetupBackgroundBusy()) applySetupButtonBusy(action, false);
}
