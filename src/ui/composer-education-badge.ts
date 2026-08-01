/**
 * Persistent Education Mode indicator in the composer control strip.
 *
 * A toggle that changes what the agent will do for you must not be invisible from
 * the chat view, or the student spends ten minutes wondering why nothing gets
 * edited. It mounts as a sibling of #modeSelector so the strip's compact-width
 * measurement accounts for it, and clicking it jumps to the setting that caused it.
 */

import { isEducationModeEnabledSync, loadEducationMeta } from '../config/education-meta';
import { observeModeSelectorComposerSibling, refreshModeSelectorLayout } from './mode-selector';

const BADGE_ID = 'composerEducationBadge';

const BADGE_TITLE =
  'Education Mode is on. The assistant reviews and guides, but will not edit your files. Click to change it in Settings.';

let badgeEl: HTMLButtonElement | null = null;

function getBadgeEl(): HTMLButtonElement | null {
  if (badgeEl?.isConnected) return badgeEl;
  badgeEl = document.getElementById(BADGE_ID) as HTMLButtonElement | null;
  return badgeEl;
}

function createBadge(): HTMLButtonElement | null {
  const host = document.getElementById('composerControls');
  if (!host) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = BADGE_ID;
  btn.className = 'composer-education-badge';
  btn.title = BADGE_TITLE;
  btn.setAttribute('aria-label', BADGE_TITLE);

  const label = document.createElement('span');
  label.className = 'composer-education-badge__label';
  label.textContent = 'Education';
  btn.appendChild(label);

  btn.addEventListener('click', () => {
    void import('./settings-page').then((m) => m.openSettings('general'));
  });

  const anchor = document.getElementById('modeSelector');
  if (anchor?.parentElement === host) {
    anchor.after(btn);
  } else {
    host.insertBefore(btn, host.firstChild);
  }

  observeModeSelectorComposerSibling(btn);
  badgeEl = btn;
  return btn;
}

/** Show or hide the badge from the cached flag (safe to call on every sync). */
export function refreshEducationBadge(): void {
  const enabled = isEducationModeEnabledSync();
  const existing = getBadgeEl();

  if (!enabled) {
    if (existing) {
      existing.remove();
      badgeEl = null;
      refreshModeSelectorLayout();
    }
    return;
  }

  if (!existing) {
    if (createBadge()) refreshModeSelectorLayout();
  }
}

/** Load the flag, then render (call once during composer init). */
export async function initEducationBadge(): Promise<void> {
  try {
    await loadEducationMeta();
  } catch {
    // Fall back to the localStorage mirror rather than skipping the indicator.
  }
  refreshEducationBadge();
}
