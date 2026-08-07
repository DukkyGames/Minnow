/**
 * Left app rail — fixed roster for workspace-first shell navigation.
 */

import { getAppById } from './app-registry';
import { listRailApps, subscribeAppPreferences } from './app-preferences';
import { createAppIcon } from './icons';
import {
  getForegroundAppId,
  getOsView,
  subscribeInstances,
} from './instances';
import { isDesktopResearchActive } from './desktop-state';
import { launchApp } from './router';
import { shouldSuppressDesktopChrome } from './shell-chrome';
import type { AppId } from './types';

const RAIL_SETTINGS_ID: AppId = 'settings';

/** Whether the rail should treat Research as the active app (phase 3 will refine). */
function isResearchRailActive(): boolean {
  if (getForegroundAppId() === 'research') return true;
  return getOsView() === 'workspaces' && isDesktopResearchActive();
}

function isRailAppActive(appId: AppId): boolean {
  if (appId === 'research') return isResearchRailActive();
  return getForegroundAppId() === appId;
}

function buildRailButton(appId: AppId, label: string, tooltip: string): HTMLButtonElement {
  const def = getAppById(appId);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mn-os-app-rail__btn';
  btn.dataset.appId = appId;
  btn.title = tooltip;
  btn.setAttribute('aria-label', label);
  const icon = createAppIcon((def?.icon ?? 'code') as 'code');
  btn.appendChild(icon);
  btn.addEventListener('click', () => launchApp(appId));
  return btn;
}

function syncRailButtons(tileByAppId: Map<AppId, HTMLButtonElement>): void {
  for (const [appId, btn] of tileByAppId) {
    const active = isRailAppActive(appId);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

function syncRailVisibility(root: HTMLElement): void {
  const onWorkspaces = getOsView() === 'workspaces';
  const hide = shouldSuppressDesktopChrome() || onWorkspaces;
  root.hidden = hide;
}

/**
 * Mount the 56px app rail inside `#osAppRail`.
 * Returns cleanup for shell teardown.
 */
export function initAppRail(root: HTMLElement): () => void {
  root.replaceChildren();
  root.setAttribute('role', 'navigation');
  root.setAttribute('aria-label', 'Apps');

  const nav = document.createElement('div');
  nav.className = 'mn-os-app-rail__nav';

  const tileByAppId = new Map<AppId, HTMLButtonElement>();

  function rebuild(): void {
    nav.replaceChildren();
    tileByAppId.clear();

    for (const app of listRailApps()) {
      const btn = buildRailButton(app.id, app.name, app.tag);
      tileByAppId.set(app.id, btn);
      nav.appendChild(btn);
    }

    const divider = document.createElement('div');
    divider.className = 'mn-os-app-rail__divider';
    divider.setAttribute('aria-hidden', 'true');
    nav.appendChild(divider);

    const settings = getAppById(RAIL_SETTINGS_ID);
    if (settings) {
      const settingsBtn = buildRailButton(
        RAIL_SETTINGS_ID,
        settings.name,
        settings.tag,
      );
      tileByAppId.set(RAIL_SETTINGS_ID, settingsBtn);
      nav.appendChild(settingsBtn);
    }

    syncRailButtons(tileByAppId);
  }

  root.appendChild(nav);
  rebuild();

  const onInstances = (): void => {
    syncRailButtons(tileByAppId);
    syncRailVisibility(root);
  };

  const unsubInstances = subscribeInstances(onInstances);
  const unsubPrefs = subscribeAppPreferences(rebuild);
  syncRailVisibility(root);

  return () => {
    unsubInstances();
    unsubPrefs();
    root.replaceChildren();
  };
}
