/**
 * Left app rail — fixed roster for workspace-first shell navigation.
 *
 * The rail is the shell's only navigation column. Clicking a background app
 * brings it forward; clicking the foreground app toggles its session panel, so
 * the panel never has to collapse into a second icon rail beside this one.
 */

import { getAppById } from './app-registry';
import { listRailApps, subscribeAppPreferences } from './app-preferences';
import { createAppIcon } from './icons';
import {
  getForegroundAppId,
  getOsView,
  subscribeInstances,
} from './instances';
import { isChatToggleVisible } from './menubar-visibility';
import { isCoarsePointer } from '../ui/mobile-layout';
import { CHAT_SIDEBAR_CHANGED_EVENT } from '../ui/layout-events';
import { isResearchPanelOpen, subscribeResearchPanel } from '../ui/research-panel';
import { launchApp } from './router';
import type { AppId } from './types';

const TOOLTIP_DELAY_MS = 500;
const TOOLTIP_GAP_PX = 10;
const TOOLTIP_EDGE_PAD_PX = 8;

function isRailAppActive(appId: AppId): boolean {
  return getForegroundAppId() === appId;
}

function isRailAppHosting(appId: AppId): boolean {
  return appId === 'code' && isResearchPanelOpen() && getForegroundAppId() === 'code';
}

/** Apps that own a session panel; only these toggle instead of re-launching. */
function railAppOwnsPanel(appId: AppId): boolean {
  return isChatToggleVisible(appId);
}

/** Read panel state from the DOM so menubar and rail toggles never disagree. */
function isRailPanelOpen(): boolean {
  const panel = document.getElementById('chatSidebar');
  if (!panel) return false;
  if (document.documentElement.classList.contains('mn-narrow')) {
    return panel.classList.contains('mobile-open');
  }
  return !panel.classList.contains('collapsed');
}

/** Tooltip label: name for navigation, the actual outcome for the panel toggle. */
function railTooltipText(appId: AppId, label: string): string {
  if (!railAppOwnsPanel(appId) || !isRailAppActive(appId)) return label;
  return isRailPanelOpen() ? 'Hide chats' : 'Show chats';
}

let tooltipEl: HTMLDivElement | null = null;
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
let tooltipAnchor: HTMLElement | null = null;
let tooltipTextFor: (() => string) | null = null;

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
  tooltipTextFor = null;
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
  layer.dataset.side = isBottomRail ? 'top' : 'right';

  if (isBottomRail) {
    const centerX = anchorBox.left + anchorBox.width / 2;
    layer.style.left = `${centerX}px`;
    layer.style.bottom = `${window.innerHeight - anchorBox.top + TOOLTIP_GAP_PX}px`;
    layer.style.transform = 'translateX(-50%)';
    return;
  }

  // Clamp vertically so tiles near the viewport edges keep the label on screen.
  const height = layer.offsetHeight;
  const centerY = anchorBox.top + anchorBox.height / 2;
  const minY = TOOLTIP_EDGE_PAD_PX + height / 2;
  const maxY = window.innerHeight - TOOLTIP_EDGE_PAD_PX - height / 2;
  const clampedY = Math.min(Math.max(centerY, minY), Math.max(minY, maxY));

  layer.style.left = `${anchorBox.right + TOOLTIP_GAP_PX}px`;
  layer.style.top = `${clampedY}px`;
  layer.style.transform = 'translateY(-50%)';
  // Arrow tracks the tile, not the clamped box, so it still points at its source.
  layer.style.setProperty('--rail-tooltip-arrow-y', `${centerY - clampedY + height / 2}px`);
}

function showRailTooltip(anchor: HTMLElement, getText: () => string): void {
  if (isCoarsePointer()) return;
  const layer = ensureTooltipLayer();
  layer.textContent = getText();
  layer.hidden = false;
  tooltipAnchor = anchor;
  tooltipTextFor = getText;
  positionRailTooltip(anchor, layer);
}

function scheduleRailTooltip(anchor: HTMLElement, getText: () => string): void {
  if (isCoarsePointer()) return;
  clearTooltipTimer();
  tooltipTimer = setTimeout(() => {
    tooltipTimer = null;
    showRailTooltip(anchor, getText);
  }, TOOLTIP_DELAY_MS);
}

/** Refresh a visible tooltip in place after the panel state changes under it. */
function refreshRailTooltip(): void {
  if (!tooltipAnchor || !tooltipTextFor || !tooltipEl || tooltipEl.hidden) return;
  tooltipEl.textContent = tooltipTextFor();
  positionRailTooltip(tooltipAnchor, tooltipEl);
}

function bindRailTooltip(btn: HTMLButtonElement, getText: () => string): void {
  const onEnter = (): void => scheduleRailTooltip(btn, getText);
  const onLeave = (): void => {
    if (tooltipAnchor === btn) hideRailTooltip();
  };
  const onFocus = (): void => showRailTooltip(btn, getText);
  const onBlur = (): void => {
    if (tooltipAnchor === btn) hideRailTooltip();
  };

  btn.addEventListener('mouseenter', onEnter);
  btn.addEventListener('mouseleave', onLeave);
  btn.addEventListener('focus', onFocus);
  btn.addEventListener('blur', onBlur);
}

/** Foreground + owns a panel means the click toggles rather than re-launches. */
function handleRailClick(appId: AppId): void {
  if (railAppOwnsPanel(appId) && isRailAppActive(appId)) {
    void import('../ui/layout').then((m) => m.toggleSidebarLayout());
    return;
  }
  launchApp(appId);
}

function buildRailButton(appId: AppId, label: string): HTMLButtonElement {
  const def = getAppById(appId);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mn-os-app-rail__btn';
  btn.dataset.appId = appId;
  btn.setAttribute('aria-label', label);
  const icon = createAppIcon((def?.icon ?? 'code') as 'code');
  btn.appendChild(icon);
  bindRailTooltip(btn, () => railTooltipText(appId, label));
  btn.addEventListener('click', () => handleRailClick(appId));
  return btn;
}

function syncRailButtons(tileByAppId: Map<AppId, HTMLButtonElement>): void {
  const panelOpen = isRailPanelOpen();
  for (const [appId, btn] of tileByAppId) {
    const hosting = isRailAppHosting(appId);
    const active = isRailAppActive(appId);
    const ownsPanel = railAppOwnsPanel(appId);
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-hosting', hosting);
    // Tile fill carries panel state; icon colour carries "you are here".
    btn.classList.toggle('is-panel-closed', active && ownsPanel && !panelOpen);
    btn.setAttribute('aria-current', active ? 'page' : hosting ? 'true' : 'false');
    if (active && ownsPanel) {
      btn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
      btn.setAttribute('aria-label', panelOpen ? 'Hide chats' : 'Show chats');
    } else {
      btn.removeAttribute('aria-expanded');
      const label = getAppById(appId)?.name;
      if (label) btn.setAttribute('aria-label', label);
    }
  }
  refreshRailTooltip();
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
      const btn = buildRailButton(app.id, app.name);
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

  // Panel can also be toggled from the menubar; mirror it so the tile never lies.
  const onPanelChange = (): void => syncRailButtons(tileByAppId);
  window.addEventListener(CHAT_SIDEBAR_CHANGED_EVENT, onPanelChange);

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
    window.removeEventListener(CHAT_SIDEBAR_CHANGED_EVENT, onPanelChange);
    unsubInstances();
    unsubPrefs();
    unsubResearch();
    hideRailTooltip();
    tooltipEl?.remove();
    tooltipEl = null;
    root.replaceChildren();
  };
}
