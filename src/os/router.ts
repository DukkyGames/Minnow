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
/** Preserves launch options (e.g. concierge seed) across hash-only navigation. */
let pendingLaunchOptions: LaunchOptions | undefined;

/** Map legacy hashes to MinnowOS routes before parsing. */
export function resolveLegacyHash(hash: string): { hash: string; settingsSection?: string } {
  const trimmed = hash || '#/';
  if (trimmed.startsWith('#/settings')) {
    const match = trimmed.replace(/^#\/?/, '').match(/^settings(?:\/([\w-]+))?/);
    return {
      hash: '#/app/settings',
      settingsSection: match?.[1] ?? 'general',
    };
  }
  if (trimmed === '#/benchmark' || trimmed.startsWith('#/benchmark/')) {
    return { hash: '#/app/bench' };
  }
  if (trimmed === '#/compare' || trimmed.startsWith('#/compare/')) {
    return { hash: '#/app/compare' };
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
  const appMatch = normalized.match(/^#\/app\/([\w-]+)/);
  if (appMatch && isAppId(appMatch[1])) {
    const route: OsRoute = { view: 'app', appId: appMatch[1] };
    if (route.appId === 'settings' && pendingSettingsSection) {
      route.settingsSection = pendingSettingsSection;
    }
    return route;
  }
  return { view: 'desktop' };
}

/** Current route derived from location hash + pending redirect state. */
export function getCurrentRoute(): OsRoute {
  const { hash, settingsSection } = resolveLegacyHash(window.location.hash);
  if (settingsSection) pendingSettingsSection = settingsSection;
  return parseOsHash(hash);
}

function hashForRoute(route: OsRoute): string {
  if (route.view === 'desktop') return '#/desktop';
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
      window.location.hash = legacy.hash;
      return;
    }
    pendingSettingsSection = legacy.settingsSection ?? pendingSettingsSection;
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
  const next = `#/app/${appId}`;
  if (window.location.hash !== next) {
    pendingLaunchOptions = options;
    window.location.hash = next;
    return;
  }
  applyRoute({ view: 'app', appId, settingsSection: options?.settingsSection }, options);
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
