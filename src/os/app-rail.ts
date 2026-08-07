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

import { isCoarsePointer } from '../ui/mobile-layout';

import { isResearchPanelOpen, subscribeResearchPanel } from '../ui/research-panel';

import { launchApp } from './router';

import type { AppId } from './types';



const TOOLTIP_DELAY_MS = 500;



function isRailAppActive(appId: AppId): boolean {

  return getForegroundAppId() === appId;

}



function isRailAppHosting(appId: AppId): boolean {

  return appId === 'code' && isResearchPanelOpen() && getForegroundAppId() === 'code';

}



let tooltipEl: HTMLDivElement | null = null;

let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

let tooltipAnchor: HTMLElement | null = null;



function clearTooltipTimer(): void {

  if (tooltipTimer) {

    clearTimeout(tooltipTimer);

    tooltipTimer = null;

  }

}



/** Body portal so labels paint above chat/code side rails (stack above #minnowOsRoot). */
function ensureTooltipLayer(): HTMLDivElement {
  if (tooltipEl?.isConnected) return tooltipEl;
  tooltipEl?.remove();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'mn-os-app-rail__tooltip';
  tooltipEl.hidden = true;
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}



function hideRailTooltip(): void {

  clearTooltipTimer();

  tooltipAnchor = null;

  if (tooltipEl) tooltipEl.hidden = true;

}



function positionRailTooltip(anchor: HTMLElement, layer: HTMLDivElement): void {
  const anchorBox = anchor.getBoundingClientRect();
  const isBottomRail = document.documentElement.classList.contains('mn-narrow');

  layer.style.left = '';
  layer.style.top = '';
  layer.style.bottom = '';
  layer.style.right = '';
  layer.style.transform = '';

  if (isBottomRail) {
    const centerX = anchorBox.left + anchorBox.width / 2;
    layer.style.left = `${centerX}px`;
    layer.style.bottom = `${window.innerHeight - anchorBox.top + 8}px`;
    layer.style.transform = 'translateX(-50%)';
    return;
  }

  const centerY = anchorBox.top + anchorBox.height / 2;
  layer.style.left = `${anchorBox.right + 10}px`;
  layer.style.top = `${centerY}px`;
  layer.style.transform = 'translateY(-50%)';
}



function showRailTooltip(anchor: HTMLElement, text: string): void {

  if (isCoarsePointer()) return;

  const layer = ensureTooltipLayer();

  layer.textContent = text;

  layer.hidden = false;

  tooltipAnchor = anchor;

  positionRailTooltip(anchor, layer);

}



function scheduleRailTooltip(anchor: HTMLElement, text: string): void {

  if (isCoarsePointer()) return;

  clearTooltipTimer();

  tooltipTimer = setTimeout(() => {

    tooltipTimer = null;

    showRailTooltip(anchor, text);

  }, TOOLTIP_DELAY_MS);

}



function bindRailTooltip(btn: HTMLButtonElement, text: string): void {

  const onEnter = (): void => scheduleRailTooltip(btn, text);

  const onLeave = (): void => {

    if (tooltipAnchor === btn) hideRailTooltip();

  };

  const onFocus = (): void => showRailTooltip(btn, text);

  const onBlur = (): void => {

    if (tooltipAnchor === btn) hideRailTooltip();

  };



  btn.addEventListener('mouseenter', onEnter);

  btn.addEventListener('mouseleave', onLeave);

  btn.addEventListener('focus', onFocus);

  btn.addEventListener('blur', onBlur);

}



function buildRailButton(
  appId: AppId,
  label: string,
  tooltip: string,
): HTMLButtonElement {

  const def = getAppById(appId);

  const btn = document.createElement('button');

  btn.type = 'button';

  btn.className = 'mn-os-app-rail__btn';

  btn.dataset.appId = appId;

  btn.setAttribute('aria-label', label);

  const icon = createAppIcon((def?.icon ?? 'code') as 'code');

  btn.appendChild(icon);

  bindRailTooltip(btn, tooltip);

  btn.addEventListener('click', () => launchApp(appId));

  return btn;

}



function syncRailButtons(tileByAppId: Map<AppId, HTMLButtonElement>): void {

  for (const [appId, btn] of tileByAppId) {

    const hosting = isRailAppHosting(appId);

    const active = isRailAppActive(appId);

    btn.classList.toggle('is-active', active);

    btn.classList.toggle('is-hosting', hosting);

    btn.setAttribute('aria-current', active ? 'page' : hosting ? 'true' : 'false');

  }

}



/** Hide the rail only on the workspace gate; keep it visible in fullscreen apps. */
function syncRailVisibility(root: HTMLElement): void {
  root.hidden = getOsView() === 'workspaces';
}



/**

 * Mount the left app rail (`--sidebar-rail`) inside `#osAppRail`.

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

    hideRailTooltip();

    nav.replaceChildren();

    tileByAppId.clear();

    if (tooltipEl) {

      tooltipEl.remove();

      tooltipEl = null;

    }



    for (const app of listRailApps()) {

      const btn = buildRailButton(app.id, app.name, app.tag);

      tileByAppId.set(app.id, btn);

      nav.appendChild(btn);

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

  const unsubResearch = subscribeResearchPanel(onInstances);

  syncRailVisibility(root);



  const onLayoutChange = (): void => {

    if (tooltipAnchor && tooltipEl && !tooltipEl.hidden) {

      positionRailTooltip(tooltipAnchor, tooltipEl);

    }

  };

  window.addEventListener('resize', onLayoutChange, { passive: true });
  window.addEventListener('scroll', onLayoutChange, { passive: true, capture: true });



  return () => {

    window.removeEventListener('resize', onLayoutChange);
    window.removeEventListener('scroll', onLayoutChange, true);

    unsubInstances();

    unsubPrefs();

    unsubResearch();

    hideRailTooltip();

    tooltipEl?.remove();

    tooltipEl = null;

    root.replaceChildren();

  };

}


