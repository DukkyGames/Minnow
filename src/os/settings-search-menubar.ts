/**
 * Reparents the settings global finder into the OS menubar while Settings is open.
 */

import { isOsShellEnabled } from './page-bridge';

const FINDER_ID = 'settingsSearchFinder';
const HOME_SLOT_ID = 'settingsSearchFinderSlot';
const MENUBAR_SLOT_ID = 'osMenubarSettingsSearchSlot';

function getFinder(): HTMLElement | null {
  return document.getElementById(FINDER_ID);
}

function getHomeSlot(): HTMLElement | null {
  return document.getElementById(HOME_SLOT_ID);
}

function getMenubarSlot(): HTMLElement | null {
  return document.getElementById(MENUBAR_SLOT_ID);
}

/** Move the settings search finder into the menubar center slot. */
export function mountSettingsSearchToMenubar(): void {
  if (!isOsShellEnabled()) return;

  const finder = getFinder();
  const menubarSlot = getMenubarSlot();
  const homeSlot = getHomeSlot();
  if (!finder || !menubarSlot || !homeSlot) return;
  if (finder.parentElement === menubarSlot) return;

  menubarSlot.appendChild(finder);
  finder.classList.add('is-in-menubar');
}

/** Return the settings search finder to the settings page header slot. */
export function unmountSettingsSearchFromMenubar(): void {
  const finder = getFinder();
  const homeSlot = getHomeSlot();
  const menubarSlot = getMenubarSlot();
  if (!finder || !homeSlot) return;
  if (finder.parentElement === homeSlot) return;

  homeSlot.appendChild(finder);
  finder.classList.remove('is-in-menubar');
}

/** Whether the finder currently lives in the menubar (tests). */
export function isSettingsSearchInMenubar(): boolean {
  const finder = getFinder();
  const menubarSlot = getMenubarSlot();
  return Boolean(finder && menubarSlot && finder.parentElement === menubarSlot);
}
