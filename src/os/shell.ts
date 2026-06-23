import '../styles/minnowos-shell.css';
import '../styles/minnowos-desktop.css';
import '../styles/minnowos-wallpaper.css';
import '../styles/minnowos-windows.css';
import '../styles/minnowos-apps.css';
import '../styles/scheduler-side-panel.css';
import '../styles/git-panel.css';
import '../styles/research-page.css';
import '../styles/superplan.css';

import { initAppHost } from './app-host';
import { renderDesktop } from './desktop';
import { initDockLauncher } from './dock-launcher';
import { renderMenubar } from './menubar';
import { createOsIcon } from './icons';
import { isOsShellEnabled } from './page-bridge';

const BOOT_MS = 1300;

let shellCleanup: (() => void) | null = null;

function ensureShellDom(): {
  root: HTMLElement;
  menubar: HTMLElement;
  desktopLayer: HTMLElement;
  dockLayer: HTMLElement;
} {
  let root = document.getElementById('minnowOsRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'minnowOsRoot';
    root.className = 'mn-os';
    document.body.prepend(root);
  }

  let menubar = document.getElementById('osMenubar');
  if (!menubar) {
    menubar = document.createElement('div');
    menubar.id = 'osMenubar';
    root.appendChild(menubar);
  }

  let stage = document.getElementById('osStage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'osStage';
    stage.className = 'mn-os-stage';
    root.appendChild(stage);
  }

  let desktopLayer = document.getElementById('osDesktopLayer');
  if (!desktopLayer) {
    desktopLayer = document.createElement('div');
    desktopLayer.id = 'osDesktopLayer';
    desktopLayer.className = 'mn-os-desktop-layer';
    stage.appendChild(desktopLayer);
  }

  if (!document.getElementById('osWindowsLayer')) {
    const windowsLayer = document.createElement('div');
    windowsLayer.id = 'osWindowsLayer';
    windowsLayer.className = 'mn-os-windows-layer';
    stage.appendChild(windowsLayer);
  }

  if (!document.getElementById('osSidePanelsLayer')) {
    const sidePanelsLayer = document.createElement('div');
    sidePanelsLayer.id = 'osSidePanelsLayer';
    sidePanelsLayer.className = 'mn-os-side-panels-layer';
    stage.appendChild(sidePanelsLayer);
  }

  if (!document.getElementById('osAppsLayer')) {
    const appsLayer = document.createElement('div');
    appsLayer.id = 'osAppsLayer';
    appsLayer.className = 'mn-os-apps-layer';
    stage.appendChild(appsLayer);
  }

  let dockLayer = document.getElementById('osDockLayer');
  if (!dockLayer) {
    dockLayer = document.createElement('div');
    dockLayer.id = 'osDockLayer';
    stage.appendChild(dockLayer);
  }

  return { root, menubar, desktopLayer, dockLayer };
}

function showBootSplash(root: HTMLElement): void {
  const boot = document.createElement('div');
  boot.className = 'mn-os-boot';
  boot.setAttribute('role', 'status');
  boot.setAttribute('aria-label', 'Starting MinnowOS');

  const logo = document.createElement('div');
  logo.className = 'mn-os-boot-logo';
  logo.appendChild(createOsIcon('fish', { size: 40 }));

  const name = document.createElement('div');
  name.className = 'mn-os-boot-name';
  name.textContent = 'MinnowOS';

  const bar = document.createElement('div');
  bar.className = 'mn-os-boot-bar';
  bar.appendChild(document.createElement('span'));

  boot.append(logo, name, bar);
  root.appendChild(boot);

  window.setTimeout(() => boot.remove(), BOOT_MS + 500);
}

/** Boot the MinnowOS shell UI (desktop, menubar, app host). */
export function initOsShell(): void {
  if (!isOsShellEnabled()) return;

  shellCleanup?.();

  document.documentElement.classList.add('minnow-os-enabled');

  const { root, menubar, desktopLayer, dockLayer } = ensureShellDom();
  showBootSplash(root);

  const cleanupDesktop = renderDesktop(desktopLayer);
  const cleanupDock = initDockLauncher(dockLayer);
  const cleanupMenubar = renderMenubar(menubar);
  shellCleanup = () => {
    cleanupDesktop();
    cleanupDock();
    cleanupMenubar();
  };

  initAppHost();
  void import('./scheduler-side-panel').then((m) => m.initSchedulerSidePanel());
  // Re-apply route now that app layers are mounted (router may have queued an app open).
  void import('./router').then((m) => m.syncOsRouteFromHash());

  window.addEventListener(
    'beforeunload',
    () => {
      shellCleanup?.();
      shellCleanup = null;
    },
    { once: true },
  );
}
