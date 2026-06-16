import {
  activateDesktopChat,
  activateDesktopExperts,
  activateDesktopResearch,
  consumePendingDesktopChatActivation,
  consumePendingDesktopExpertsActivation,
  consumePendingDesktopResearchActivation,
  deactivateDesktopExperts,
  deactivateDesktopResearch,
  isDesktopExpertsActive,
  isDesktopResearchActive,
  queueDesktopChatActivation,
  queueDesktopExpertsActivation,
  queueDesktopResearchActivation,
} from './desktop-state';
import { isAppId } from './app-registry';
import {
  closeInstance,
  getForegroundAppId,
  getInstanceSnapshot,
  getOsView,
  launchInstance,
  showDesktop,
} from './instances';
import { osOnAppClose, osOnAppOpen } from './page-bridge';
import type { AppId, LaunchOptions, OsRoute } from './types';

let initialized = false;
let applyingRoute = false;
let lastForegroundApp: AppId | null = null;
let pendingSettingsSection: string | undefined;
let pendingModelsSection: string | undefined;
let pendingBrainSection: string | undefined;
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

/** Map legacy hashes to MinnowOS routes before parsing. */
export function resolveLegacyHash(hash: string): {
  hash: string;
  settingsSection?: string;
  modelsSection?: string;
  brainSection?: string;
  desktopChat?: boolean;
  desktopResearch?: boolean;
  desktopExperts?: boolean;
} {
  const trimmed = hash || '#/';
  if (trimmed.startsWith('#/settings')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^settings(?:\/([\w-]+))?/);
    const slug = match?.[1] ?? 'general';
    const modelsSection = MODELS_SETTINGS_REDIRECTS[slug];
    if (modelsSection) {
      return { hash: `#/app/models/${modelsSection}`, modelsSection };
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
    return { hash: '#/app/bench' };
  }
  if (trimmed === '#/compare' || trimmed.startsWith('#/compare/')) {
    return { hash: '#/app/compare' };
  }
  if (trimmed === '#/scheduler' || trimmed.startsWith('#/scheduler/')) {
    return { hash: '#/app/scheduler' };
  }
  if (trimmed === '#/calendar' || trimmed.startsWith('#/calendar/')) {
    return { hash: '#/app/calendar' };
  }
  if (trimmed === '#/email' || trimmed.startsWith('#/email/')) {
    return { hash: '#/app/email' };
  }
  if (trimmed === '#/models' || trimmed.startsWith('#/models/')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^models(?:\/([\w-]+))?/);
    const section = match?.[1] ?? 'recommend';
    return { hash: `#/app/models/${section}`, modelsSection: section };
  }
  if (trimmed === '#/brain' || trimmed.startsWith('#/brain/')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^brain(?:\/([\w-]+))?/);
    const section = match?.[1] ?? 'graph';
    return { hash: `#/app/brain/${section}`, brainSection: section };
  }
  if (trimmed === '#/research' || trimmed.startsWith('#/research/')) {
    return { hash: '#/desktop', desktopResearch: true };
  }
  if (trimmed === '#/app/research' || trimmed.startsWith('#/app/research/')) {
    return { hash: '#/desktop', desktopResearch: true };
  }
  if (trimmed === '#/experts' || trimmed.startsWith('#/experts/')) {
    return { hash: '#/desktop', desktopExperts: true };
  }
  if (trimmed === '#/app/experts' || trimmed.startsWith('#/app/experts/')) {
    return { hash: '#/desktop', desktopExperts: true };
  }
  if (trimmed === '#/app/chat' || trimmed.startsWith('#/app/chat/')) {
    return { hash: '#/desktop', desktopChat: true };
  }
  return { hash: trimmed };
}

/** Parse a normalized hash into an OS route. */
export function parseOsHash(hash: string): OsRoute {
  const normalized = hash || '#/';
  if (normalized === '#/' || normalized === '#' || normalized === '#/desktop') {
    return { view: 'desktop' };
  }
  const appMatch = normalized.match(/^#\/app\/([\w-]+)(?:\/([\w-]+))?/);
  if (appMatch && isAppId(appMatch[1])) {
    const route: OsRoute = { view: 'app', appId: appMatch[1] };
    if (route.appId === 'settings' && pendingSettingsSection) {
      route.settingsSection = pendingSettingsSection;
    }
    if (route.appId === 'models') {
      route.modelsSection = appMatch[2] ?? pendingModelsSection ?? 'recommend';
    }
    if (route.appId === 'brain') {
      route.brainSection = appMatch[2] ?? pendingBrainSection ?? 'graph';
    }
    return route;
  }
  return { view: 'desktop' };
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
  if (route.view === 'desktop') return '#/desktop';
  if (route.appId === 'models' && route.modelsSection) {
    return `#/app/models/${route.modelsSection}`;
  }
  if (route.appId === 'brain' && route.brainSection) {
    return `#/app/brain/${route.brainSection}`;
  }
  if (route.appId) return `#/app/${route.appId}`;
  return '#/desktop';
}

function syncForegroundLifecycle(nextApp: AppId | null): void {
  if (lastForegroundApp && lastForegroundApp !== nextApp) {
    osOnAppClose(lastForegroundApp);
  }
  if (nextApp && nextApp !== lastForegroundApp) {
    osOnAppOpen(nextApp);
  }
  lastForegroundApp = nextApp;
}

function applyRoute(route: OsRoute, options?: LaunchOptions): void {
  if (route.view === 'desktop') {
    syncForegroundLifecycle(null);
    showDesktop();
    const pendingResearch = consumePendingDesktopResearchActivation();
    if (pendingResearch !== null) {
      void activateDesktopResearch(pendingResearch);
      return;
    }
    const pendingExperts = consumePendingDesktopExpertsActivation();
    if (pendingExperts !== null) {
      void activateDesktopExperts(pendingExperts);
      return;
    }
    const pendingChat = consumePendingDesktopChatActivation();
    if (pendingChat !== null) {
      void activateDesktopChat(pendingChat);
    }
    return;
  }

  if (!route.appId) {
    syncForegroundLifecycle(null);
    showDesktop();
    return;
  }

  const launchOpts: LaunchOptions = { ...options };
  if (route.settingsSection) {
    launchOpts.settingsSection = route.settingsSection;
    pendingSettingsSection = route.settingsSection;
  }
  if (route.modelsSection) {
    launchOpts.modelsSection = route.modelsSection;
    pendingModelsSection = route.modelsSection;
  }
  if (route.brainSection) {
    launchOpts.brainSection = route.brainSection;
    pendingBrainSection = route.brainSection;
  }

  launchInstance(route.appId, launchOpts);
  syncForegroundLifecycle(route.appId);
}

function applyRouteFromHash(): void {
  if (applyingRoute) return;
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
      if (legacy.desktopResearch) {
        queueDesktopResearchActivation(pendingLaunchOptions);
      }
      if (legacy.desktopExperts) {
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

/** Navigate to the desktop launcher. */
export function navigateToDesktop(): void {
  const next = '#/desktop';
  if (window.location.hash !== next) {
    window.location.hash = next;
    return;
  }
  applyRoute({ view: 'desktop' });
}

/** Launch or foreground an app and update the hash. */
export function launchApp(appId: AppId, options?: LaunchOptions): void {
  if (appId === 'chat') {
    queueDesktopChatActivation(options);
    navigateToDesktop();
    return;
  }
  if (appId === 'research') {
    if (getOsView() === 'desktop' && isDesktopResearchActive()) {
      deactivateDesktopResearch();
      return;
    }
    queueDesktopResearchActivation(options);
    navigateToDesktop();
    return;
  }
  if (appId === 'experts') {
    if (getOsView() === 'desktop' && isDesktopExpertsActive()) {
      deactivateDesktopExperts();
      return;
    }
    queueDesktopExpertsActivation(options);
    navigateToDesktop();
    return;
  }
  if (appId === 'scheduler') {
    const snap = getInstanceSnapshot();
    const existing = snap.instances.find((i) => i.appId === 'scheduler');
    if (existing && snap.foregroundId === existing.id && getOsView() === 'desktop') {
      closeInstance(existing.id);
      if (window.location.hash.includes('scheduler')) {
        navigateToDesktop();
      }
      return;
    }
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
  const next =
    appId === 'models' && options?.modelsSection
      ? `#/app/models/${options.modelsSection}`
      : appId === 'brain' && options?.brainSection
        ? `#/app/brain/${options.brainSection}`
        : `#/app/${appId}`;
  if (window.location.hash !== next) {
    pendingLaunchOptions = options;
    window.location.hash = next;
    return;
  }
  applyRoute(
    {
      view: 'app',
      appId,
      settingsSection: options?.settingsSection,
      modelsSection: options?.modelsSection,
      brainSection: options?.brainSection,
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
  pendingSettingsSection = undefined;
  pendingModelsSection = undefined;
  pendingBrainSection = undefined;
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

export { hashForRoute };
