/**
 * Ctrl+Tab app surface cycling (macOS Cmd+Tab–style, scoped to Minnow apps).
 * Uses a most-recently-used stack of Desktop + dock apps.
 */

import { APP_SWITCHER_DESKTOP_ID, type AppSwitcherItemId } from './surface-id';
import { isAppAvailable } from './app-preferences';
import { getForegroundAppId } from './instances';
import { launchApp, navigateToDesktop } from './router';
import type { AppId } from './types';

const MAX_MRU = 24;

let mruStack: AppSwitcherItemId[] = [APP_SWITCHER_DESKTOP_ID];
let keyboardBound = false;

/** Whether a switcher surface can be activated right now. */
function isSurfaceAvailable(id: AppSwitcherItemId): boolean {
  if (id === APP_SWITCHER_DESKTOP_ID) return true;
  return isAppAvailable(id as AppId);
}

/** Current OS surface for MRU indexing (foreground app, else Desktop). */
export function getCurrentAppSurfaceId(): AppSwitcherItemId {
  const foreground = getForegroundAppId();
  if (foreground) return foreground;
  return APP_SWITCHER_DESKTOP_ID;
}

/** Push a surface to the front of the MRU stack after navigation. */
export function recordAppSurfaceFocus(id: AppSwitcherItemId): void {
  if (!isSurfaceAvailable(id)) return;
  mruStack = [id, ...mruStack.filter((entry) => entry !== id)];
  if (mruStack.length > MAX_MRU) {
    mruStack.length = MAX_MRU;
  }
}

/** MRU entries that are still available, preserving recent-first order. */
export function listCycleableAppSurfaces(): AppSwitcherItemId[] {
  const seen = new Set<AppSwitcherItemId>();
  const out: AppSwitcherItemId[] = [];
  for (const id of mruStack) {
    if (seen.has(id) || !isSurfaceAvailable(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function activateSurface(id: AppSwitcherItemId): void {
  if (id === APP_SWITCHER_DESKTOP_ID) {
    navigateToDesktop();
    return;
  }
  launchApp(id);
}

/** Cycle forward (Ctrl+Tab) or backward (Ctrl+Shift+Tab) through recent app surfaces. */
export function cycleAppSurfaces(direction: 'forward' | 'backward'): void {
  const candidates = listCycleableAppSurfaces();
  if (candidates.length <= 1) return;

  const current = getCurrentAppSurfaceId();
  const currentIndex = candidates.indexOf(current);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const delta = direction === 'forward' ? 1 : -1;
  const nextIndex = (baseIndex + delta + candidates.length) % candidates.length;
  const next = candidates[nextIndex];
  if (!next || next === current) return;
  activateSurface(next);
}

/** Bind global Ctrl+Tab / Ctrl+Shift+Tab (not Cmd+Tab — reserved for OS / editor tabs on macOS). */
export function initAppFocusCycleKeyboard(): void {
  if (keyboardBound) return;
  keyboardBound = true;

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented) return;
      if (!event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'Tab') return;

      // Let the keyboard-help overlay keep Tab focus trapping.
      const helpPanel = document.getElementById('shellKeyboardHelpPanel');
      if (helpPanel && !helpPanel.hidden) return;

      event.preventDefault();
      cycleAppSurfaces(event.shiftKey ? 'backward' : 'forward');
    },
    true,
  );
}

/** Seed MRU from the live shell (tests / boot). */
export function syncAppSurfaceMruFromShell(): void {
  recordAppSurfaceFocus(getCurrentAppSurfaceId());
}

/** Read MRU order (tests). */
export function getAppSurfaceMruForTests(): readonly AppSwitcherItemId[] {
  return [...mruStack];
}

/** Reset module state (tests). */
export function resetAppFocusCycleForTests(): void {
  mruStack = [APP_SWITCHER_DESKTOP_ID];
  keyboardBound = false;
}
