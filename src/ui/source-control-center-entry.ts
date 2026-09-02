const OPEN_BUTTON_ID = 'btnGitCenter';

let bound = false;

/** Open the center, lazily loading the surface on first use. */
export async function openSourceControlCenterLazy(options?: {
  section?: 'changes' | 'history' | 'branches' | 'stashes' | 'worktrees' | 'pulls' | 'checks';
}): Promise<void> {
  const module = await import('./source-control-center');
  await module.openSourceControlCenter(options);
  syncOpenButtonState(true);
}

/** Close the center if it is open. */
export async function closeSourceControlCenterLazy(): Promise<void> {
  const module = await import('./source-control-center');
  module.closeSourceControlCenter();
  syncOpenButtonState(false);
}

function syncOpenButtonState(open: boolean): void {
  const btn = document.getElementById(OPEN_BUTTON_ID);
  if (!btn) return;
  btn.classList.toggle('is-active', open);
  btn.setAttribute('aria-pressed', String(open));
}

/** Wire the sidebar button that opens the center. */
export function initSourceControlCenter(): void {
  if (bound) return;
  bound = true;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(`#${OPEN_BUTTON_ID}`)) return;

    event.preventDefault();
    void toggleSourceControlCenterLazy();
  });
}

async function toggleSourceControlCenterLazy(): Promise<void> {
  const module = await import('./source-control-center');
  if (module.isSourceControlCenterOpen()) {
    module.closeSourceControlCenter();
    syncOpenButtonState(false);
    return;
  }
  await module.openSourceControlCenter();
  syncOpenButtonState(true);
}

/** Reset module state (tests). */
export function resetSourceControlCenterEntryForTests(): void {
  bound = false;
}
