import { getForegroundAppId, getOsView, subscribeInstances } from './instances';
import type { AppId } from './types';

/** Feature flag — always on until a gradual rollout toggle exists. */
export function isOsShellEnabled(): boolean {
  return true;
}

/** True when the legacy chat workspace (`#appBody`) should be hidden. */
export function shouldHideAppBody(): boolean {
  if (!isOsShellEnabled()) return false;
  if (getOsView() === 'desktop') return true;
  return getForegroundAppId() !== 'code';
}

/** Hide or show legacy chrome (topbar + chat shell) for the OS shell. */
export function syncLegacyChromeVisibility(): void {
  if (!isOsShellEnabled()) return;

  const hideLegacy = shouldHideAppBody();
  const appBody = document.getElementById('appBody');
  const topbar = document.querySelector('header.topbar');

  appBody?.classList.toggle('hidden', hideLegacy);
  topbar?.classList.toggle('hidden', hideLegacy);

  const view = getOsView();
  document.documentElement.classList.toggle('os-desktop', view === 'desktop');
  document.documentElement.classList.toggle('os-in-app', view === 'app');

  const fg = getForegroundAppId();
  if (fg) {
    document.documentElement.dataset.osApp = fg;
  } else {
    delete document.documentElement.dataset.osApp;
  }

  void import('../ui/preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

/** Called when an app becomes foreground — sync DOM + dataset for page modules. */
export function osOnAppOpen(appId: AppId): void {
  if (!isOsShellEnabled()) return;
  document.documentElement.dataset.osApp = appId;
  syncLegacyChromeVisibility();
}

/** Called when a foreground app is replaced or the shell returns to desktop. */
export function osOnAppClose(appId: AppId): void {
  if (!isOsShellEnabled()) return;
  if (document.documentElement.dataset.osApp === appId) {
    delete document.documentElement.dataset.osApp;
  }
  syncLegacyChromeVisibility();
}

let visibilityBound = false;

/** Keep legacy chrome in sync whenever instance/view state changes. */
export function initOsPageBridge(): void {
  if (visibilityBound || !isOsShellEnabled()) return;
  visibilityBound = true;
  subscribeInstances(() => {
    syncLegacyChromeVisibility();
  });
  syncLegacyChromeVisibility();
}

/** Reset bridge bindings (tests). */
export function resetOsPageBridgeForTests(): void {
  visibilityBound = false;
  delete document.documentElement.dataset.osApp;
  document.documentElement.classList.remove('os-desktop', 'os-in-app');
}
