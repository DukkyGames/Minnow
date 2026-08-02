import '../styles/minnowos-shell.css';
import '../styles/minnowos-desktop.css';
import '../styles/minnowos-wallpaper.css';
import '../styles/minnowos-windows.css';
import '../styles/minnowos-apps.css';
import '../styles/scheduler-side-panel.css';
import '../styles/git-panel.css';
import '../styles/research-page.css';

import { initAppHost } from './app-host';
import { renderDesktop } from './desktop';
import { initDockLauncher } from './dock-launcher';
import { renderMenubar } from './menubar';
import { isOsShellEnabled } from './page-bridge';

let shellCleanup: (() => void) | null = null;

function ensureShellDom(): {
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

  return { menubar, desktopLayer, dockLayer };
}

/** Boot the Minnow Shell UI (desktop, menubar, app host). */
export function initOsShell(): void {
  if (!isOsShellEnabled()) return;

  shellCleanup?.();

  document.documentElement.classList.add('minnow-os-enabled');

  const { menubar, desktopLayer, dockLayer } = ensureShellDom();

  const cleanupDesktop = renderDesktop(desktopLayer);
  const cleanupDock = initDockLauncher(dockLayer);
  const cleanupMenubar = renderMenubar(menubar);
  shellCleanup = () => {
    cleanupDesktop();
    cleanupDock();
    cleanupMenubar();
  };

  initAppHost();
  void import('../ui/product-wiki').then((module) => module.initProductWiki());
  void import('./window-focus-cycle').then((m) => m.initOsShellKeyboard());
  void import('./app-focus-cycle').then((m) => {
    m.initAppFocusCycleKeyboard();
    m.syncAppSurfaceMruFromShell();
  });
  void import('./scheduler-side-panel').then((m) => m.initSchedulerSidePanel());

  window.addEventListener(
    'beforeunload',
    () => {
      shellCleanup?.();
      shellCleanup = null;
    },
    { once: true },
  );
}
