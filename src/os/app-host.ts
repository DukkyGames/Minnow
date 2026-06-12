import { isOsShellEnabled } from './page-bridge';
import {
  getForegroundAppId,
  getInstanceSnapshot,
  subscribeInstances,
  type InstanceSnapshot,
} from './instances';
import { getCurrentRoute } from './router';
import type { AppId } from './types';
import type { SettingsSectionId } from '../ui/settings-page-types';

const APP_LAYER_IDS: Record<AppId, string> = {
  code: 'osAppLayer-code',
  chat: 'chatView',
  settings: 'settingsView',
  research: 'researchView',
  bench: 'benchmarkView',
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
  for (const id of ['settingsView', 'benchmarkView', 'researchView', 'expertsView', 'chatView']) {
    document.getElementById(id)?.classList.remove('is-open');
  }
}

async function openAppPage(appId: AppId, seed?: string): Promise<void> {
  const route = getCurrentRoute();

  switch (appId) {
    case 'settings': {
      const { openSettings } = await import('../ui/settings-page');
      openSettings((route.settingsSection ?? 'general') as SettingsSectionId);
      break;
    }
    case 'research': {
      const { openResearch } = await import('../research/panel');
      openResearch();
      if (seed) {
        const query = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
        if (query && !query.value.trim()) query.value = seed;
      }
      break;
    }
    case 'bench': {
      const { openBenchmark } = await import('../ui/benchmark-page');
      openBenchmark();
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
        !welcome.isWelcomeDismissedForSession()
      ) {
        welcome.openWelcome({ skipHash: true });
      }
      break;
    }
    case 'chat': {
      const { openChatApp } = await import('../ui/chat-app');
      await openChatApp(seed);
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

  const seed = snapshot.instances.find((i) => i.id === snapshot.foregroundId)?.seed;

  if (appId !== lastForegroundApp) {
    showAppLayer(appId);
    void openAppPage(appId, seed);
    lastForegroundApp = appId;
  } else if (seed && appId === 'chat') {
    void openAppPage('chat', seed);
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
