import {
  activateDesktopChat,
  activateDesktopExperts,
  consumePendingDesktopChatActivation,
  consumePendingDesktopExpertsActivation,
  deactivateDesktopExperts,
  prepareDesktopChatSurface,
  prepareDesktopExpertsSurface,
  queueDesktopChatActivation,
  queueDesktopExpertsActivation,
} from './desktop-state';
import { getAppById, isAppId } from './app-registry';
import { getAppUnavailableReason, isAppAvailable } from './app-preferences';
import { DEFAULT_MODELS_SECTION } from '../ui/models-section-ids';
import {
  getForegroundAppId,
  getInstanceSnapshot,
  getOsView,
  launchInstance,
  showWorkspaces,
} from './instances';
import { isPhoneLayout } from '../ui/mobile-layout';
import { windowManager } from './window-manager';
import { recordAppSurfaceFocus } from './app-focus-cycle';
import { APP_SWITCHER_DESKTOP_ID } from './surface-id';
import { osOnAppClose, osOnAppOpen } from './page-bridge';
import type { AppId, CodeSectionId, LaunchOptions, OsRoute } from './types';

/** Legacy `#/app/…` target, or workspace gate when that app is unavailable. */
function legacyHashForApp(appId: AppId): string {
  if (!isAppAvailable(appId)) return '#/workspaces';
  return `#/app/${appId}`;
}

/** Explain blocked deep links for user-disabled apps; stay quiet for developer-hidden. */
function notifyAppUnavailable(appId: AppId): void {
  const reason = getAppUnavailableReason(appId);
  if (reason !== 'user-disabled') return;
  const name = getAppById(appId)?.name ?? 'That app';
  void import('../ui/toast').then((m) => {
    m.showToast(`${name} is turned off. Restore it in Settings → Apps.`, 'error');
  });
}

/**
 * Minimize open window sheets so the phone desktop is actually visible. The app
 * instance stays alive; relaunching it from the dock restores the sheet.
 */
function parkPhoneWindowSheets(): void {
  if (!isPhoneLayout()) return;
  for (const win of windowManager.getWindows()) {
    if (!win.minimized) windowManager.minimize(win.id, true);
  }
}

/** Block unavailable apps: toast (when user-disabled) and return to desktop. */
function rejectUnavailableApp(appId: AppId): boolean {
  if (isAppAvailable(appId)) return false;
  notifyAppUnavailable(appId);
  navigateToDesktop();
  return true;
}

let initialized = false;
let applyingRoute = false;
let lastForegroundApp: AppId | null = null;
let lastRecordedSurface: typeof APP_SWITCHER_DESKTOP_ID | AppId | null = null;
let pendingSettingsSection: string | undefined;
let pendingModelsSection: string | undefined;
let pendingBrainSection: string | undefined;
let pendingCodeSection: CodeSectionId | undefined;
/** Preserves launch options (e.g. concierge seed) across hash-only navigation. */
let pendingLaunchOptions: LaunchOptions | undefined;

/** Settings sections moved into the Models app (legacy #/settings/… redirects). */
const MODELS_SETTINGS_REDIRECTS: Record<string, string> = {
  providers: 'providers',
  'model-routing': 'routing',
  usage: 'usage',
  sampler: 'sampler',
  thinking: 'thinking',
  voice: 'voice',
};

/** Map legacy hashes to Minnow routes before parsing. */
export function resolveLegacyHash(hash: string): {
  hash: string;
  settingsSection?: string;
  modelsSection?: string;
  brainSection?: string;
  desktopChat?: boolean;
  desktopResearch?: boolean;
  desktopExperts?: boolean;
  codeResearch?: boolean;
} {
  const trimmed = hash || '#/';
  if (trimmed === '#/desktop' || trimmed === '#/' || trimmed === '#' || trimmed === '#/workspaces') {
    return { hash: '#/workspaces' };
  }
  if (trimmed.startsWith('#/settings')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^settings(?:\/([\w-]+))?/);
    const slug = match?.[1] ?? 'general';
    const modelsSection = MODELS_SETTINGS_REDIRECTS[slug];
    if (modelsSection) {
      return { hash: `#/app/models/${modelsSection}`, modelsSection };
    }
    if (slug === 'memory') {
      return { hash: '#/app/brain/memories', brainSection: 'memories' };
    }
    if (slug === 'knowledge') {
      return { hash: '#/app/settings', settingsSection: 'rules' };
    }
    if (slug === 'scheduler') {
      return { hash: '#/app/scheduler' };
    }
    return {
      hash: '#/app/settings',
      settingsSection: slug,
    };
  }
  if (trimmed === '#/benchmark' || trimmed.startsWith('#/benchmark/')) {
    return { hash: legacyHashForApp('bench') };
  }
  if (trimmed === '#/compare' || trimmed.startsWith('#/compare/')) {
    return { hash: legacyHashForApp('compare') };
  }
  if (trimmed === '#/scheduler' || trimmed.startsWith('#/scheduler/')) {
    return { hash: '#/app/scheduler' };
  }
  if (trimmed === '#/calendar' || trimmed.startsWith('#/calendar/')) {
    return { hash: legacyHashForApp('calendar') };
  }
  if (trimmed === '#/email' || trimmed.startsWith('#/email/')) {
    return { hash: legacyHashForApp('email') };
  }
  if (trimmed === '#/bugs' || trimmed.startsWith('#/bugs/')) {
    return { hash: '#/app/issues' };
  }
  if (trimmed === '#/models' || trimmed.startsWith('#/models/')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^models(?:\/([\w-]+))?/);
    const section = match?.[1] ?? DEFAULT_MODELS_SECTION;
    return { hash: `#/app/models/${section}`, modelsSection: section };
  }
  if (trimmed === '#/brain' || trimmed.startsWith('#/brain/')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^brain(?:\/([\w-]+))?/);
    const section = match?.[1] ?? 'graph';
    return { hash: `#/app/brain/${section}`, brainSection: section };
  }
  if (trimmed === '#/research' || trimmed.startsWith('#/research/')) {
    return { hash: '#/app/code/chat', codeResearch: true };
  }
  if (trimmed === '#/app/research' || trimmed.startsWith('#/app/research/')) {
    return { hash: '#/app/code/chat', codeResearch: true };
  }
  if (trimmed === '#/experts' || trimmed.startsWith('#/experts/')) {
    return { hash: legacyHashForApp('experts') };
  }
  if (trimmed === '#/app/experts' || trimmed.startsWith('#/app/experts/')) {
    return { hash: trimmed };
  }
  if (trimmed === '#/app/chat' || trimmed.startsWith('#/app/chat/')) {
    return { hash: '#/workspaces', desktopChat: true };
  }
  return { hash: trimmed };
}

/** Parse a normalized hash into an OS route. */
export function parseOsHash(hash: string): OsRoute {
  const normalized = hash || '#/';
  if (
    normalized === '#/' ||
    normalized === '#' ||
    normalized === '#/workspaces' ||
    normalized === '#/desktop'
  ) {
    return { view: 'workspaces' };
  }
  const appMatch = normalized.match(/^#\/app\/([\w-]+)(?:\/([\w-]+))?/);
  if (appMatch && isAppId(appMatch[1])) {
    const route: OsRoute = { view: 'app', appId: appMatch[1] };
    if (route.appId === 'settings' && pendingSettingsSection) {
      route.settingsSection = pendingSettingsSection;
    }
    if (route.appId === 'models') {
      route.modelsSection = appMatch[2] ?? pendingModelsSection ?? DEFAULT_MODELS_SECTION;
    }
    if (route.appId === 'brain') {
      route.brainSection = appMatch[2] ?? pendingBrainSection ?? 'graph';
    }
    if (route.appId === 'code') {
      const seg = appMatch[2];
      route.codeSection =
        seg === 'overview'
          ? 'overview'
          : seg === 'dev-server'
            ? 'dev-server'
            : (pendingCodeSection ?? 'chat');
    }
    // Prepare Issues deep-link parse for Phase 2 detail panel.
    if (route.appId === 'issues' && appMatch[2]) {
      route.issueId = appMatch[2];
    }
    return route;
  }
  return { view: 'workspaces' };
}

/** Current route derived from location hash + pending redirect state. */
export function getCurrentRoute(): OsRoute {
  const { hash, settingsSection, modelsSection, brainSection } = resolveLegacyHash(window.location.hash);
  if (settingsSection) pendingSettingsSection = settingsSection;
  if (modelsSection) pendingModelsSection = modelsSection;
  if (brainSection) pendingBrainSection = brainSection;
  return parseOsHash(hash);
}

function hashForRoute(route: OsRoute): string {
  if (route.view === 'workspaces') return '#/workspaces';
  if (route.appId === 'models' && route.modelsSection) {
    return `#/app/models/${route.modelsSection}`;
  }
  if (route.appId === 'brain' && route.brainSection) {
    return `#/app/brain/${route.brainSection}`;
  }
  if (route.appId === 'code') {
    const section = route.codeSection ?? 'chat';
    if (section === 'overview') return '#/app/code/overview';
    if (section === 'dev-server') return '#/app/code/dev-server';
    return '#/app/code/chat';
  }
  if (route.appId === 'issues' && route.issueId) {
    return `#/app/issues/${route.issueId}`;
  }
  if (route.appId) return `#/app/${route.appId}`;
  return '#/workspaces';
}

function syncForegroundLifecycle(nextApp: AppId | null): void {
  if (lastForegroundApp && lastForegroundApp !== nextApp) {
    osOnAppClose(lastForegroundApp);
  }
  if (nextApp && nextApp !== lastForegroundApp) {
    osOnAppOpen(nextApp);
  }
  lastForegroundApp = nextApp;

  const surfaceId = nextApp ?? APP_SWITCHER_DESKTOP_ID;
  if (surfaceId !== lastRecordedSurface) {
    recordAppSurfaceFocus(surfaceId);
    lastRecordedSurface = surfaceId;
  }
}

function applyRoute(route: OsRoute, options?: LaunchOptions): void {
  if (route.view === 'workspaces') {
    syncForegroundLifecycle(null);
    parkPhoneWindowSheets();
    const comingFromFullscreenApp = getOsView() === 'app';
    const pendingExperts = consumePendingDesktopExpertsActivation();
    const pendingChat = consumePendingDesktopChatActivation();
    // Apply desktop surface classes before instance emit so app-host never paints idle hero.
    if (comingFromFullscreenApp) {
      if (pendingExperts !== null && isAppAvailable('experts')) {
        prepareDesktopExpertsSurface();
      } else if (pendingChat !== null) {
        prepareDesktopChatSurface();
      }
    }
    showWorkspaces();
    void import('./workspace-gate').then((m) => m.syncWorkspaceGateFromRoute());
    if (pendingExperts !== null) {
      if (isAppAvailable('experts')) {
        void activateDesktopExperts(pendingExperts);
      } else {
        void import('./desktop-launch').then((m) => m.restoreDesktopSessionOnForeground());
      }
      return;
    }
    if (pendingChat !== null) {
      void activateDesktopChat(pendingChat);
    } else {
      void import('./desktop-launch').then((m) => m.restoreDesktopSessionOnForeground());
    }
    return;
  }

  if (!route.appId) {
    syncForegroundLifecycle(null);
    showWorkspaces();
    return;
  }

  if (!isAppAvailable(route.appId)) {
    notifyAppUnavailable(route.appId);
    syncForegroundLifecycle(null);
    showWorkspaces();
    if (typeof window !== 'undefined' && window.location.hash !== '#/workspaces') {
      window.location.hash = '#/workspaces';
    }
    return;
  }

  const routeFields: LaunchOptions = {};
  if (route.settingsSection) {
    routeFields.settingsSection = route.settingsSection;
    pendingSettingsSection = route.settingsSection;
  }
  if (route.modelsSection) {
    routeFields.modelsSection = route.modelsSection;
    pendingModelsSection = route.modelsSection;
  }
  if (route.brainSection) {
    routeFields.brainSection = route.brainSection;
    pendingBrainSection = route.brainSection;
  }
  if (route.codeSection) {
    routeFields.codeSection = route.codeSection;
    pendingCodeSection = route.codeSection;
  }

  const launchOpts =
    options || Object.keys(routeFields).length > 0
      ? { ...options, ...routeFields }
      : undefined;

  launchInstance(route.appId, launchOpts);
  syncForegroundLifecycle(route.appId);
}

function applyRouteFromHash(): void {
  if (applyingRoute) return;
  if (window.location.hash === '#/wiki' || window.location.hash.startsWith('#/wiki/')) {
    void import('../ui/product-wiki').then((module) => module.initProductWiki());
    return;
  }
  applyingRoute = true;
  try {
    const raw = window.location.hash;
    const legacy = resolveLegacyHash(raw);
    if (legacy.hash !== raw) {
      if (legacy.settingsSection) pendingSettingsSection = legacy.settingsSection;
      if (legacy.modelsSection) pendingModelsSection = legacy.modelsSection;
      if (legacy.brainSection) pendingBrainSection = legacy.brainSection;
      if (legacy.desktopChat) {
        queueDesktopChatActivation(pendingLaunchOptions);
      }
      if (legacy.codeResearch) {
        void import('../ui/research-panel').then((m) => {
          m.queueResearchPanelOpen(pendingLaunchOptions);
        });
      }
      if (legacy.desktopExperts && isAppAvailable('experts')) {
        queueDesktopExpertsActivation(pendingLaunchOptions);
      }
      window.location.hash = legacy.hash;
      return;
    }
    pendingSettingsSection = legacy.settingsSection ?? pendingSettingsSection;
    pendingModelsSection = legacy.modelsSection ?? pendingModelsSection;
    pendingBrainSection = legacy.brainSection ?? pendingBrainSection;
    const opts = pendingLaunchOptions;
    pendingLaunchOptions = undefined;
    applyRoute(parseOsHash(raw), opts);
  } finally {
    applyingRoute = false;
  }
}

function onHashChange(): void {
  applyRouteFromHash();
}

/** Navigate to the workspace gate. */
export function navigateToWorkspaces(): void {
  const next = '#/workspaces';
  if (window.location.hash !== next) {
    window.location.hash = next;
    return;
  }
  applyRoute({ view: 'workspaces' });
}

/** @deprecated Phase 5 — use navigateToWorkspaces */
export function navigateToDesktop(): void {
  navigateToWorkspaces();
}

/** Launch or foreground an app and update the hash. */
export function launchApp(appId: AppId, options?: LaunchOptions): void {
  if (rejectUnavailableApp(appId)) return;

  if (appId === 'research') {
    void import('../ui/research-panel').then((m) => {
      if (m.isResearchPanelOpen()) {
        m.closeResearchPanel();
        return;
      }
      m.queueResearchPanelOpen({
        seed: options?.seed,
        autoRun: options?.autoRun ?? Boolean(options?.seed?.trim()),
      });
      launchApp('code', {
        ...options,
        codeSection: 'chat',
      });
    });
    return;
  }

  if (options?.settingsSection) {
    pendingSettingsSection = options.settingsSection;
  }
  if (options?.modelsSection) {
    pendingModelsSection = options.modelsSection;
  }
  if (options?.brainSection) {
    pendingBrainSection = options.brainSection;
  }
  if (options?.codeSection) {
    pendingCodeSection = options.codeSection;
  }
  if (appId === 'settings' && getForegroundAppId() === 'code') {
    options = {
      ...options,
      returnToApp: 'code',
      codeSection:
        options?.codeSection ?? pendingCodeSection ?? getCurrentRoute().codeSection ?? 'chat',
    };
  }
  const codeSection: CodeSectionId | undefined =
    appId === 'code'
      ? options?.chatId?.trim() ||
        options?.seed?.trim() ||
        options?.modeId ||
        options?.workspacePath?.trim()
        ? 'chat'
        : (options?.codeSection ?? 'chat')
      : undefined;
  const next =
    appId === 'models' && options?.modelsSection
      ? `#/app/models/${options.modelsSection}`
      : appId === 'brain' && options?.brainSection
        ? `#/app/brain/${options.brainSection}`
        : appId === 'code'
          ? codeSection === 'chat'
            ? '#/app/code/chat'
            : codeSection === 'dev-server'
              ? '#/app/code/dev-server'
              : '#/app/code/overview'
          : `#/app/${appId}`;
  if (window.location.hash !== next) {
    pendingLaunchOptions = options;
    window.location.hash = next;
    applyRouteFromHash();
    return;
  }
  applyRoute(
    {
      view: 'app',
      appId,
      settingsSection: options?.settingsSection,
      modelsSection: options?.modelsSection,
      brainSection: options?.brainSection,
      codeSection,
    },
    options,
  );
}

/** Attach the single hashchange listener and sync the initial route. */
export function initOsRouter(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('hashchange', onHashChange);
  applyRouteFromHash();
}

/** Whether the router listener is active (tests). */
export function isOsRouterInitialized(): boolean {
  return initialized;
}

/** Re-sync shell UI from the current hash without changing it. */
export function syncOsRouteFromHash(): void {
  applyRouteFromHash();
}

/** Re-sync from hash without changing it (tests). */
export function syncOsRouteFromHashForTests(): void {
  syncOsRouteFromHash();
}

/** Reset router module state (tests). */
export function resetOsRouterForTests(): void {
  if (initialized) {
    window.removeEventListener('hashchange', onHashChange);
  }
  initialized = false;
  applyingRoute = false;
  lastForegroundApp = null;
  lastRecordedSurface = null;
  pendingSettingsSection = undefined;
  pendingModelsSection = undefined;
  pendingBrainSection = undefined;
  pendingCodeSection = undefined;
  pendingLaunchOptions = undefined;
}

/** Expose snapshot helpers for page bridge / shell UI. */
export function getRouterStateForTests(): {
  view: ReturnType<typeof getOsView>;
  foregroundAppId: ReturnType<typeof getForegroundAppId>;
  snapshot: ReturnType<typeof getInstanceSnapshot>;
} {
  return {
    view: getOsView(),
    foregroundAppId: getForegroundAppId(),
    snapshot: getInstanceSnapshot(),
  };
}

/** Navigate to the Code app overview dashboard. */
export function navigateToCodeOverview(): void {
  const next = '#/app/code/overview';
  if (window.location.hash !== next) {
    pendingCodeSection = 'overview';
    window.location.hash = next;
    return;
  }
  applyRoute({ view: 'app', appId: 'code', codeSection: 'overview' });
}

/** Navigate to the Code app chat workspace. */
export function navigateToCodeChat(): void {
  const next = '#/app/code/chat';
  if (window.location.hash !== next) {
    pendingCodeSection = 'chat';
    window.location.hash = next;
    return;
  }
  applyRoute({ view: 'app', appId: 'code', codeSection: 'chat' });
}

/** Navigate to the Code app Dev Servers screen. */
export function navigateToCodeDevServers(): void {
  const next = '#/app/code/dev-server';
  if (window.location.hash !== next) {
    pendingCodeSection = 'dev-server';
    window.location.hash = next;
    return;
  }
  applyRoute({ view: 'app', appId: 'code', codeSection: 'dev-server' });
}

export { hashForRoute };
