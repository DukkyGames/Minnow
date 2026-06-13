import { isAppId } from './app-registry';
import {
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
/** Preserves launch options (e.g. concierge seed) across hash-only navigation. */
let pendingLaunchOptions: LaunchOptions | undefined;

/** Settings sections moved into the Models app (legacy #/settings/… redirects). */
const MODELS_SETTINGS_REDIRECTS: Record<string, string> = {
  providers: 'providers',
  'model-routing': 'routing',
  usage: 'usage',
  sampler: 'sampler',
  thinking: 'thinking',
};

/** Map legacy hashes to MinnowOS routes before parsing. */
export function resolveLegacyHash(hash: string): {
  hash: string;
  settingsSection?: string;
  modelsSection?: string;
} {
  const trimmed = hash || '#/';
  if (trimmed.startsWith('#/settings')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^settings(?:\/([\w-]+))?/);
    const slug = match?.[1] ?? 'general';
    const modelsSection = MODELS_SETTINGS_REDIRECTS[slug];
    if (modelsSection) {
      return { hash: `#/app/models/${modelsSection}`, modelsSection };
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
  if (trimmed === '#/models' || trimmed.startsWith('#/models/')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^models(?:\/([\w-]+))?/);
    const section = match?.[1] ?? 'recommend';
    return { hash: `#/app/models/${section}`, modelsSection: section };
  }
  if (trimmed === '#/research' || trimmed.startsWith('#/research/')) {
    return { hash: '#/app/research' };
  }
  if (trimmed === '#/experts' || trimmed.startsWith('#/experts/')) {
    return { hash: '#/app/experts' };
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
    return route;
  }
  return { view: 'desktop' };
}

/** Current route derived from location hash + pending redirect state. */
export function getCurrentRoute(): OsRoute {
  const { hash, settingsSection, modelsSection } = resolveLegacyHash(window.location.hash);
  if (settingsSection) pendingSettingsSection = settingsSection;
  if (modelsSection) pendingModelsSection = modelsSection;
  return parseOsHash(hash);
}

function hashForRoute(route: OsRoute): string {
  if (route.view === 'desktop') return '#/desktop';
  if (route.appId === 'models' && route.modelsSection) {
    return `#/app/models/${route.modelsSection}`;
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
      window.location.hash = legacy.hash;
      return;
    }
    pendingSettingsSection = legacy.settingsSection ?? pendingSettingsSection;
    pendingModelsSection = legacy.modelsSection ?? pendingModelsSection;
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
  if (options?.settingsSection) {
    pendingSettingsSection = options.settingsSection;
  }
  if (options?.modelsSection) {
    pendingModelsSection = options.modelsSection;
  }
  const next =
    appId === 'models' && options?.modelsSection
      ? `#/app/models/${options.modelsSection}`
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
