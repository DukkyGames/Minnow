import { isOsShellEnabled } from './page-bridge';
import {
  getForegroundAppId,
  getInstanceSnapshot,
  subscribeInstances,
  type InstanceSnapshot,
} from './instances';
import { getCurrentRoute } from './router';
import type { AppId, LaunchOptions } from './types';
import type { SettingsSectionId } from '../ui/settings-page-types';

const APP_LAYER_IDS: Record<AppId, string> = {
  code: 'osAppLayer-code',
  chat: 'chatView',
  settings: 'settingsView',
  research: 'researchView',
  bench: 'benchmarkView',
  compare: 'compareView',
  experts: 'expertsView',
};

let initialized = false;
let lastForegroundApp: AppId | null = null;

function getAppsLayer(): HTMLElement | null {
  return document.getElementById('osAppsLayer');
}

function getStage(): HTMLElement | null {
  return document.getElementById('osStage');
}

function mountAppLayers(): void {
  const appsLayer = getAppsLayer();
  if (!appsLayer || appsLayer.dataset.mounted === '1') return;
  appsLayer.dataset.mounted = '1';

  const topbar = document.querySelector('header.topbar');
  const appBody = document.getElementById('appBody');

  if (appBody) {
    const codeWrap = document.createElement('div');
    codeWrap.id = 'osAppLayer-code';
    codeWrap.className = 'mn-os-app-layer mn-os-code-layer';
    codeWrap.dataset.osApp = 'code';
    if (topbar) codeWrap.appendChild(topbar);
    codeWrap.appendChild(appBody);
    const welcome = document.getElementById('welcomeView');
    if (welcome) codeWrap.appendChild(welcome);
    appsLayer.appendChild(codeWrap);
  }

  for (const [appId, elId] of Object.entries(APP_LAYER_IDS)) {
    if (appId === 'code') continue;
    const el = document.getElementById(elId);
    if (el) {
      el.classList.add('mn-os-app-layer');
      el.dataset.osApp = appId;
      appsLayer.appendChild(el);
    }
  }
}

function layerForApp(appId: AppId): HTMLElement | null {
  return document.getElementById(APP_LAYER_IDS[appId]);
}

function setLayerActive(el: HTMLElement | null, active: boolean): void {
  if (!el) return;
  el.classList.toggle('is-active', active);
}

function hideAllLayers(): void {
  for (const appId of Object.keys(APP_LAYER_IDS) as AppId[]) {
    setLayerActive(layerForApp(appId), false);
  }
}

function closeAllAppPages(): void {
  for (const id of [
    'settingsView',
    'benchmarkView',
    'compareView',
    'researchView',
    'expertsView',
    'chatView',
  ]) {
    document.getElementById(id)?.classList.remove('is-open');
  }
}

async function openAppPage(appId: AppId, options?: LaunchOptions): Promise<void> {
  const route = getCurrentRoute();
  const settingsSection =
    options?.settingsSection ?? route.settingsSection ?? 'general';

  switch (appId) {
    case 'settings': {
      const { openSettings } = await import('../ui/settings-page');
      openSettings(settingsSection as SettingsSectionId);
      break;
    }
    case 'research': {
      const { openResearch } = await import('../research/panel');
      openResearch({
        seed: options?.seed,
        autoRun: options?.autoRun ?? Boolean(options?.seed?.trim()),
      });
      break;
    }
    case 'bench': {
      const { openBenchmark } = await import('../ui/benchmark-page');
      openBenchmark();
      break;
    }
    case 'compare': {
      const { openCompare } = await import('../ui/compare-page');
      openCompare();
      break;
    }
    case 'experts': {
      const { openExperts } = await import('../ui/experts/experts-hub');
      openExperts();
      break;
    }
    case 'code': {
      const welcome = await import('../ui/welcome-page');
      const { isDefaultWorkspace } = await import('../state/workspace');
      if (welcome.isWelcomePageOpen()) {
        welcome.closeWelcome({ skipHash: true });
      } else if (
        isDefaultWorkspace() &&
        !welcome.isWelcomeDismissedForSession() &&
        !options?.workspacePath?.trim()
      ) {
        welcome.openWelcome({ skipHash: true });
      }
      if (options?.seed?.trim() || options?.modeId || options?.workspacePath?.trim()) {
        const { applyCodeLaunchOptions } = await import('./code-launch');
        await applyCodeLaunchOptions(options);
      }
      break;
    }
    case 'chat': {
      const { openChatApp } = await import('../ui/chat-app');
      await openChatApp(options?.seed);
      break;
    }
    default:
      break;
  }
}

/** Show the requested app layer and hide others. */
export function showAppLayer(appId: AppId): void {
  hideAllLayers();
  setLayerActive(layerForApp(appId), true);
}

function launchOptionsFromSnapshot(snapshot: InstanceSnapshot): LaunchOptions | undefined {
  const inst = snapshot.instances.find((i) => i.id === snapshot.foregroundId);
  if (!inst) return undefined;
  return inst.launchOptions ?? (inst.seed ? { seed: inst.seed } : undefined);
}

function syncFromSnapshot(snapshot: InstanceSnapshot): void {
  const stage = getStage();
  if (!stage) return;

  if (snapshot.view === 'desktop') {
    stage.classList.remove('is-in-app');
    hideAllLayers();
    if (lastForegroundApp !== null) closeAllAppPages();
    lastForegroundApp = null;
    return;
  }

  stage.classList.add('is-in-app');
  const appId = getForegroundAppId();
  if (!appId) return;

  const options = launchOptionsFromSnapshot(snapshot);

  if (appId !== lastForegroundApp) {
    showAppLayer(appId);
    void openAppPage(appId, options);
    lastForegroundApp = appId;
  } else if (options && (appId === 'chat' || appId === 'code' || appId === 'research')) {
    void openAppPage(appId, options);
  }
}

/** Wire app layer visibility to instance + router state. */
export function initAppHost(): void {
  if (!isOsShellEnabled() || initialized) return;
  initialized = true;
  mountAppLayers();
  subscribeInstances((snap) => syncFromSnapshot(snap));
  syncFromSnapshot(getInstanceSnapshot());
}

/** Reset app-host bindings (tests). */
export function resetAppHostForTests(): void {
  initialized = false;
  lastForegroundApp = null;
  const appsLayer = getAppsLayer();
  if (appsLayer) delete appsLayer.dataset.mounted;
}
