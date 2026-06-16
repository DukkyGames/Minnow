import { APPS } from './app-registry';
import { isDesktopExpertsActive, isDesktopResearchActive, subscribeDesktopState } from './desktop-state';
import { createAppIcon, createOsIcon } from './icons';
import {
  getForegroundAppId,
  getInstanceSnapshot,
  getOsView,
  subscribeInstances,
} from './instances';
import { launchApp } from './router';
import { RESEARCH_LIBRARY_INSTANCE_ID } from './research-constants';
import { windowManager } from './window-manager';
import type { AppId } from './types';

/** Whether the research library window is open (avoids importing library-window CSS in tests). */
function isResearchLibraryOpen(): boolean {
  return Boolean(windowManager.findWindowByInstance(RESEARCH_LIBRARY_INSTANCE_ID));
}

/** Whether an app surface is running (instance, desktop research, or library window). */
function isDockAppOpen(appId: AppId): boolean {
  const snap = getInstanceSnapshot();
  if (snap.instances.some((inst) => inst.appId === appId)) {
    return true;
  }
  if (appId === 'research') {
    return isDesktopResearchActive() || isResearchLibraryOpen();
  }
  if (appId === 'experts') {
    return isDesktopExpertsActive();
  }
  return false;
}

/** Whether an app is the focused surface in the shell. */
function isDockAppActive(appId: AppId): boolean {
  if (getForegroundAppId() === appId) {
    return true;
  }
  if (appId === 'research' && getOsView() === 'desktop' && isDesktopResearchActive()) {
    return true;
  }
  if (appId === 'experts' && getOsView() === 'desktop' && isDesktopExpertsActive()) {
    return true;
  }
  return false;
}

/** Build one dock launcher tile for an app. */
function buildDockTile(
  app: (typeof APPS)[number],
  onLaunch: (appId: AppId) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mn-os-tile-dock';
  btn.dataset.appId = app.id;
  btn.title = app.tag;

  const ico = document.createElement('span');
  ico.className = 'mn-os-tile-ico';
  ico.appendChild(createAppIcon(app.icon as 'code', { size: 24 }));
  btn.appendChild(ico);

  const name = document.createElement('span');
  name.className = 'mn-os-tile-name';
  name.textContent = app.name;
  btn.appendChild(name);

  btn.addEventListener('click', () => onLaunch(app.id));
  return btn;
}

/**
 * Mount the app dock on the OS stage.
 * Desktop: dock always visible.
 * In-app: dock hidden by default; up-tab reveals, down-tab hides.
 */
export function initDockLauncher(root: HTMLElement): () => void {
  root.replaceChildren();
  root.className = 'mn-os-dock-shell';
  root.dataset.shellView = 'desktop';
  root.dataset.dockOpen = 'true';

  let dockOpenInApp = false;

  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'mn-os-dock-reveal';
  revealBtn.setAttribute('aria-label', 'Show app dock');
  revealBtn.title = 'Show apps';
  revealBtn.appendChild(createOsIcon('arrowUp', { size: 14 }));

  const panel = document.createElement('div');
  panel.className = 'mn-os-dock-panel';

  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.className = 'mn-os-dock-hide';
  hideBtn.setAttribute('aria-label', 'Hide app dock');
  hideBtn.title = 'Hide apps';
  hideBtn.appendChild(createOsIcon('arrowDown', { size: 14 }));

  const dock = document.createElement('div');
  dock.className = 'mn-os-dock';
  dock.setAttribute('role', 'toolbar');
  dock.setAttribute('aria-label', 'App launcher');

  const tileByAppId = new Map<AppId, HTMLButtonElement>();

  const onLaunch = (appId: AppId) => {
    launchApp(appId);
    if (getOsView() === 'app') {
      dockOpenInApp = false;
      syncShellState();
    }
  };

  for (const app of APPS) {
    if (app.id === 'chat') continue;
    const tile = buildDockTile(app, onLaunch);
    tileByAppId.set(app.id, tile);
    dock.appendChild(tile);
  }

  panel.append(hideBtn, dock);
  root.append(revealBtn, panel);

  /** Reflect open / foreground state on dock tiles. */
  function syncDockTiles(): void {
    for (const [appId, tile] of tileByAppId) {
      const open = isDockAppOpen(appId);
      const active = open && isDockAppActive(appId);
      tile.classList.toggle('is-open', open);
      tile.classList.toggle('is-active', active);
      tile.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function syncShellState(): void {
    const inApp = getOsView() === 'app';
    root.dataset.shellView = inApp ? 'app' : 'desktop';
    root.dataset.dockOpen = inApp ? (dockOpenInApp ? 'true' : 'false') : 'true';
    revealBtn.hidden = !inApp || dockOpenInApp;
    hideBtn.hidden = !inApp || !dockOpenInApp;
  }

  function openDock(): void {
    dockOpenInApp = true;
    syncShellState();
  }

  function closeDock(): void {
    dockOpenInApp = false;
    syncShellState();
    if (getOsView() === 'app' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  revealBtn.addEventListener('click', openDock);
  hideBtn.addEventListener('click', closeDock);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (getOsView() !== 'app' || !dockOpenInApp) return;
    event.preventDefault();
    closeDock();
  };

  document.addEventListener('keydown', onKeyDown);

  const unsubInstances = subscribeInstances(() => {
    if (getOsView() === 'desktop') {
      dockOpenInApp = false;
    }
    syncShellState();
    syncDockTiles();
  });
  const unsubDesktop = subscribeDesktopState(syncDockTiles);
  const unsubWindows = windowManager.subscribe(syncDockTiles);

  syncShellState();
  syncDockTiles();

  return () => {
    unsubInstances();
    unsubDesktop();
    unsubWindows();
    document.removeEventListener('keydown', onKeyDown);
  };
}
