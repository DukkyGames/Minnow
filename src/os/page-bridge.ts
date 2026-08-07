import { getForegroundAppId, getOsView, subscribeInstances } from './instances';
import { shouldSuppressDesktopChrome } from './shell-chrome';
import {
  isDesktopChatActive,
  isDesktopExpertsActive,
} from './desktop-state';
import { isResearchPanelOpen } from '../ui/research-panel';
import type { AppId } from './types';
import { isAppAvailable } from './app-preferences';
import { isDeveloperReleased } from './app-registry';

function gateOpenClass(): boolean {
  return document.documentElement.classList.contains('os-workspace-gate-open');
}

/** Feature flag — always on until a gradual rollout toggle exists. */
export function isOsShellEnabled(): boolean {
  return true;
}

/** Whether the hash belongs to the Minnow Shell (workspace gate or foreground app). */
export function isOsAppHash(hash?: string): boolean {
  const h = hash ?? window.location.hash;
  return h === '#/workspaces' || h === '#/desktop' || h.startsWith('#/app/');
}

/** Settings embedded in the OS apps layer (not legacy full-page swap). */
export function isOsEmbedded(): boolean {
  return isOsShellEnabled();
}

/** True when Code is the active fullscreen app (desktop modes may still be queued). */
function isCodeForeground(): boolean {
  return getOsView() === 'app' && getForegroundAppId() === 'code';
}

/** True when the legacy chat workspace (`#appBody`) should be hidden. */
export function shouldHideAppBody(): boolean {
  if (!isOsShellEnabled()) return false;
  // Code reparents #appBody into the fullscreen layer — never hide it while Code is foreground.
  if (isCodeForeground()) return false;
  if (isDesktopChatActive()) return true;
  if (isResearchPanelOpen()) return true;
  if (isDesktopExpertsActive()) return true;
  if (getOsView() === 'workspaces') return true;
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

  document.getElementById('btnBenchmark')?.toggleAttribute('hidden', !isAppAvailable('bench'));
  document.getElementById('btnExpertLab')?.toggleAttribute('hidden', !isAppAvailable('experts'));
  document
    .getElementById('expertsSection')
    ?.toggleAttribute('hidden', !isDeveloperReleased('experts'));

  const view = getOsView();
  const onWorkspaces = view === 'workspaces';
  const codeForeground = isCodeForeground();
  document.documentElement.classList.toggle('os-workspaces', onWorkspaces);
  // Legacy desktop chrome hooks remain until phase 5 teardown.
  document.documentElement.classList.toggle('os-desktop', onWorkspaces);
  document.documentElement.classList.toggle('os-in-app', view === 'app');
  document.documentElement.classList.toggle('os-workspace-gate', onWorkspaces && gateOpenClass());
  document.documentElement.classList.toggle(
    'os-desktop-chat',
    !codeForeground && isDesktopChatActive(),
  );
  document.documentElement.classList.toggle(
    'os-desktop-research',
    !codeForeground && isResearchPanelOpen(),
  );
  document.documentElement.classList.toggle(
    'os-desktop-experts',
    !codeForeground && isDesktopExpertsActive(),
  );

  const fg = getForegroundAppId();
  if (codeForeground) {
    document.documentElement.dataset.osApp = 'code';
  } else if (isDesktopChatActive()) {
    document.documentElement.dataset.osApp = 'chat';
  } else if (isResearchPanelOpen()) {
    document.documentElement.dataset.osApp = 'research';
  } else if (isDesktopExpertsActive()) {
    document.documentElement.dataset.osApp = 'experts';
  } else if (fg) {
    document.documentElement.dataset.osApp = fg;
  } else {
    delete document.documentElement.dataset.osApp;
  }

  void import('../ui/preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

  void import('./workspace-menubar').then((m) => m.syncWorkspaceMenubarPlacement());

  void import('./desktop-workspace-mounts').then((m) => m.syncDesktopWorkspaceMounts());

  void import('../ui/loop-active-hint').then(({ syncLoopActiveHint }) => {
    syncLoopActiveHint();
  });

  syncDesktopLayerSuppression();
}

/** Hide desktop chat/research/experts chrome during immersive fullscreen apps. */
function syncDesktopLayerSuppression(): void {
  document
    .getElementById('osDesktopLayer')
    ?.classList.toggle('is-suppressed-by-fullscreen-app', shouldSuppressDesktopChrome());
}

/** Called when an app becomes foreground — sync DOM + dataset for page modules. */
export function osOnAppOpen(appId: AppId): void {
  if (!isOsShellEnabled()) return;
  document.documentElement.dataset.osApp = appId;
  if (appId === 'code') {
    void import('../ui/preview-panel').then((preview) => {
      preview.collapsePreviewPanelKeepingSource();
    });
    void import('./desktop-workspace-mounts').then((m) => m.syncDesktopWorkspaceMounts());
  }
  syncLegacyChromeVisibility();
}

/** Called when a foreground app is replaced or the shell returns to desktop. */
export function osOnAppClose(appId: AppId): void {
  if (!isOsShellEnabled()) return;
  if (appId === 'code') {
    void import('../state/sessions').then(({ sessionState }) => {
      const activeId = sessionState?.activeId;
      if (!activeId) return;
      void import('../ui/orchestrate-plan-screen').then(({ suspendOrchestratePlanScreenOnAppLeave }) => {
        suspendOrchestratePlanScreenOnAppLeave(activeId);
      });
    });
  }
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
  void import('./desktop-state').then(({ subscribeDesktopState }) => {
    subscribeDesktopState(() => syncLegacyChromeVisibility());
  });
  void import('../ui/research-panel').then(({ subscribeResearchPanel }) => {
    subscribeResearchPanel(() => syncLegacyChromeVisibility());
  });
  void import('./window-manager').then(({ windowManager }) => {
    windowManager.subscribe(() => syncLegacyChromeVisibility());
  });
  syncLegacyChromeVisibility();
}

/** Reset bridge bindings (tests). */
export function resetOsPageBridgeForTests(): void {
  visibilityBound = false;
  delete document.documentElement.dataset.osApp;
  document.documentElement.classList.remove(
    'os-desktop',
    'os-workspaces',
    'os-in-app',
    'os-workspace-gate',
    'os-workspace-gate-open',
    'os-desktop-chat',
    'os-desktop-research',
    'os-desktop-experts',
  );
  document.getElementById('osDesktopLayer')?.classList.remove('is-suppressed-by-fullscreen-app');
}
