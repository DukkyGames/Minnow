import { getPresentationMode } from './app-registry';
import {
  CALENDAR_WINDOW_MIN_HEIGHT,
  CALENDAR_WINDOW_MIN_WIDTH,
} from './calendar-constants';
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
import { shouldSuppressDesktopChrome } from './shell-chrome';
import { windowManager } from './window-manager';
import { syncSchedulerSidePanel } from './scheduler-side-panel';
import { WINDOW_MOUNTED_APPS, runWindowTeardown } from './window-mounted-apps';

const APP_LAYER_IDS: Record<AppId, string> = {
  code: 'osAppLayer-code',
  chat: 'chatView',
  settings: 'settingsView',
  research: 'researchView',
  bench: 'benchmarkView',
  compare: 'compareView',
  models: 'modelsView',
  brain: 'brainView',
  scheduler: 'schedulerView',
  calendar: 'calendarView',
  email: 'emailView',
  experts: 'expertsView',
};

let initialized = false;
let lastForegroundApp: AppId | null = null;
const mountedWindowInstances = new Set<string>();

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
    'modelsView',
    'brainView',
    'schedulerView',
    'calendarView',
    'emailView',
    'researchView',
    'expertsView',
    'chatView',
  ]) {
    if (id === 'expertsView') {
      const view = document.getElementById('expertsView');
      const desktopMount = document.getElementById('desktopExpertsMount');
      // Lab panel on the desktop overlay — preserve is-open while reparented there.
      if (view && desktopMount?.contains(view)) {
        continue;
      }
    }
    document.getElementById(id)?.classList.remove('is-open');
  }
}

async function openAppPage(appId: AppId, options?: LaunchOptions): Promise<void> {
  const route = getCurrentRoute();
  const settingsSection =
    options?.settingsSection ?? route.settingsSection ?? 'general';

  switch (appId) {
    case 'settings': {
      const brainRoute = (await import('../ui/brain-memory-routing')).resolveBrainMemoryRoute(
        options?.settingsSearchKey,
        options?.settingsSection ?? route.settingsSection,
      );
      if (brainRoute) {
        const { openBrain } = await import('../ui/brain-page');
        openBrain(brainRoute);
        break;
      }
      const { openSettings, navigateToSettingsField } = await import('../ui/settings-page');
      const section = (options?.settingsSection ?? route.settingsSection ?? 'general') as SettingsSectionId;
      if (options?.settingsSearchKey) {
        navigateToSettingsField(options.settingsSearchKey, section);
      } else {
        openSettings(section);
      }
      break;
    }
    case 'research': {
      if (isOsShellEnabled()) {
        const { activateDesktopResearch } = await import('./desktop-state');
        await activateDesktopResearch({
          seed: options?.seed,
          autoRun: options?.autoRun ?? Boolean(options?.seed?.trim()),
        });
      } else {
        const { openResearch } = await import('../research/panel');
        openResearch({
          seed: options?.seed,
          autoRun: options?.autoRun ?? Boolean(options?.seed?.trim()),
        });
      }
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
    case 'models': {
      const { openModels } = await import('../ui/models-page');
      openModels((route.modelsSection ?? options?.modelsSection ?? 'recommend') as import('../ui/models-page').ModelsSectionId);
      break;
    }
    case 'brain': {
      const { openBrain } = await import('../ui/brain-page');
      openBrain(
        (route.brainSection ?? options?.brainSection ?? 'graph') as import('../ui/brain-page').BrainSectionId,
      );
      break;
    }
    case 'scheduler': {
      if (!isOsShellEnabled()) {
        const { openScheduler } = await import('../ui/scheduler-page');
        await openScheduler();
      }
      break;
    }
    case 'calendar': {
      const { openCalendar } = await import('../ui/calendar-page');
      await openCalendar();
      break;
    }
    case 'email': {
      const { openEmail } = await import('../ui/email-page');
      await openEmail();
      break;
    }
    case 'experts': {
      if (isOsShellEnabled()) {
        const { activateDesktopExperts } = await import('./desktop-state');
        await activateDesktopExperts({
          step: options?.step,
          expertId: options?.expertId,
        });
      } else {
        const { openExperts } = await import('../ui/experts/experts-hub');
        openExperts();
      }
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
      const route = getCurrentRoute();
      const wantsChat =
        Boolean(options?.chatId?.trim()) ||
        Boolean(options?.seed?.trim()) ||
        Boolean(options?.modeId) ||
        Boolean(options?.workspacePath?.trim()) ||
        route.codeSection === 'chat';
      const overview = await import('../ui/code-overview');
      if (!wantsChat && (route.codeSection === 'overview' || !route.codeSection)) {
        await overview.openCodeOverview();
        break;
      }
      overview.closeCodeOverview({ skipNavigate: true });
      if (options?.chatId?.trim()) {
        const { switchToCodeChat } = await import('./chat-launch');
        await switchToCodeChat(options.chatId);
      } else if (options?.seed?.trim() || options?.modeId || options?.workspacePath?.trim()) {
        const { applyCodeLaunchOptions } = await import('./code-launch');
        await applyCodeLaunchOptions(options);
      } else {
        const { restoreCodeSessionOnForeground } = await import('./code-launch');
        await restoreCodeSessionOnForeground();
      }
      break;
    }
    case 'chat': {
      const { activateDesktopChat } = await import('./desktop-state');
      await activateDesktopChat({ seed: options?.seed, chatId: options?.chatId });
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

function usesFullscreenLayer(mode: ReturnType<typeof getPresentationMode>): boolean {
  return mode === 'fullscreen' || mode === 'desktop';
}

function shouldBlurDesktop(snapshot: InstanceSnapshot): boolean {
  if (snapshot.view !== 'app') return false;
  const appId = getForegroundAppId();
  if (!appId) return false;
  return usesFullscreenLayer(getPresentationMode(appId));
}

function stashWindowContent(appId: AppId): void {
  const el = layerForApp(appId);
  if (!el) return;
  const appsLayer = getAppsLayer();
  if (appsLayer && el.parentElement !== appsLayer) {
    appsLayer.appendChild(el);
  }
  el.classList.remove('is-open');
}

async function ensureWindowSurface(
  instanceId: string,
  appId: AppId,
  options?: LaunchOptions,
): Promise<void> {
  if (!WINDOW_MOUNTED_APPS.has(appId)) return;

  const wasMounted = mountedWindowInstances.has(instanceId);
  windowManager.ensureLayer();
  const openOptions: Parameters<typeof windowManager.open>[1] = {
    instanceId,
    // Sync walks every open instance — never steal focus until the foreground pass below.
    activate: false,
  };
  if (appId === 'calendar') {
    openOptions.minWidth = CALENDAR_WINDOW_MIN_WIDTH;
    openOptions.minHeight = CALENDAR_WINDOW_MIN_HEIGHT;
  }
  const windowId = windowManager.open(appId, openOptions);
  const body = windowManager.getFrame(windowId)?.body;
  const content = layerForApp(appId);
  if (body && content && content.parentElement !== body) {
    body.appendChild(content);
  }
  mountedWindowInstances.add(instanceId);

  if (!wasMounted) {
    const layer = layerForApp(appId);
    if (!layer?.classList.contains('is-open')) {
      await openAppPage(appId, options);
    }
  }
}

function teardownWindowSurface(instanceId: string, appId: AppId): void {
  if (!mountedWindowInstances.has(instanceId)) return;
  mountedWindowInstances.delete(instanceId);

  layerForApp(appId)?.classList.remove('is-open');
  runWindowTeardown(appId);

  stashWindowContent(appId);
  const win = windowManager.findWindowByInstance(instanceId);
  if (win) windowManager.close(win.id);
}

function syncWindowSurfaces(snapshot: InstanceSnapshot): void {
  const openIds = new Set(snapshot.instances.map((i) => i.id));

  for (const inst of snapshot.instances) {
    if (getPresentationMode(inst.appId) !== 'window') continue;
    if (!WINDOW_MOUNTED_APPS.has(inst.appId)) continue;
    const options =
      inst.launchOptions ?? (inst.seed ? { seed: inst.seed } : undefined);
    void ensureWindowSurface(inst.id, inst.appId, options);
    if (inst.id === snapshot.foregroundId) {
      const win = windowManager.findWindowByInstance(inst.id);
      if (win) windowManager.focus(win.id);
    }
  }

  for (const mountedId of [...mountedWindowInstances]) {
    if (!openIds.has(mountedId)) {
      const win = windowManager.findWindowByInstance(mountedId);
      teardownWindowSurface(mountedId, win?.appId ?? 'settings');
    }
  }
}

function syncFromSnapshot(snapshot: InstanceSnapshot): void {
  const stage = getStage();
  if (!stage) return;

  syncWindowSurfaces(snapshot);

  syncSchedulerSidePanel();

  const blur = shouldBlurDesktop(snapshot);
  const immersive = shouldSuppressDesktopChrome();
  stage.classList.toggle('is-in-app', blur);
  stage.classList.toggle('is-in-app-fullscreen', blur);
  stage.classList.toggle('is-immersive-app', immersive);

  if (snapshot.view === 'desktop') {
    hideAllLayers();
    const hadFullscreenForeground =
      lastForegroundApp !== null &&
      usesFullscreenLayer(getPresentationMode(lastForegroundApp));
    if (hadFullscreenForeground) closeAllAppPages();
    lastForegroundApp = null;
    return;
  }

  const appId = getForegroundAppId();
  if (!appId) return;

  const mode = getPresentationMode(appId);
  const options = launchOptionsFromSnapshot(snapshot);

  if (mode === 'window' && WINDOW_MOUNTED_APPS.has(appId)) {
    hideAllLayers();
    lastForegroundApp = appId;
    return;
  }

  if (mode === 'desktop') {
    hideAllLayers();
    if (appId === 'chat') {
      void import('./desktop-state').then((m) =>
        m.activateDesktopChat({
          seed: options?.seed,
          chatId: options?.chatId,
        }),
      );
    } else if (appId === 'research') {
      void import('./desktop-state').then((m) =>
        m.activateDesktopResearch({
          seed: options?.seed,
          autoRun: options?.autoRun ?? Boolean(options?.seed?.trim()),
        }),
      );
    } else if (appId === 'experts') {
      void import('./desktop-state').then((m) =>
        m.activateDesktopExperts({
          step: options?.step,
          expertId: options?.expertId,
        }),
      );
    }
    lastForegroundApp = null;
    return;
  }

  if (!usesFullscreenLayer(mode)) return;

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
  windowManager.ensureLayer();
  subscribeInstances((snap) => syncFromSnapshot(snap));
  windowManager.subscribe(() => syncFromSnapshot(getInstanceSnapshot()));
  syncFromSnapshot(getInstanceSnapshot());
}

/** Reset app-host bindings (tests). */
export function resetAppHostForTests(): void {
  initialized = false;
  lastForegroundApp = null;
  mountedWindowInstances.clear();
  const appsLayer = getAppsLayer();
  if (appsLayer) delete appsLayer.dataset.mounted;
}

/** Re-run app-host sync from current instance snapshot (tests). */
export function syncAppHostForTests(): void {
  syncFromSnapshot(getInstanceSnapshot());
}
