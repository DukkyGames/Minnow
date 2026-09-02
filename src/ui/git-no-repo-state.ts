import '../styles/git-no-repo.css';
import { iconHtml } from './icon';

const DEFAULT_HINT =
  'This workspace is not tracked with git. Initialize to see branches, changes, and commit history.';

/** True when git status failed because the workspace root is not a repository. */
export function isMissingGitRepositoryError(message?: string): boolean {
  return Boolean(message && /not a git repository/i.test(message));
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
  action.textContent = 'Set up git';
  action.addEventListener('click', () => {
    if (options?.onSetupGit) {
      options.onSetupGit();
      return;
    }
    void prefillGitSetupComposer();
  });

  block.append(icon, title, hint, action);
  host.appendChild(block);
}

/** Prefill /git-setup in the Code composer and focus it. */
export async function prefillGitSetupComposer(): Promise<void> {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;
  const prompt =
    '/git-setup Initialize git in this workspace (init, .gitignore, initial commit).';
  input.value = prompt;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const { autoResize } = await import('./input');
  autoResize(input);
  input.focus();
  input.setSelectionRange(prompt.length, prompt.length);
}

/** Leave Code overview (composer hidden there) then prefill git setup. */
export async function openGitSetupFromOverview(): Promise<void> {
  const { isCodeOverviewOpen, closeCodeOverview } = await import('./code-overview');
  if (isCodeOverviewOpen()) {
    const { navigateToCodeChat } = await import('../os/router');
    closeCodeOverview({ skipNavigate: true, restoreChat: false });
    navigateToCodeChat();
  }
  await prefillGitSetupComposer();
}
