/**
 * Lazy Minnow app module initialization — defer page bundles until opened or routed at boot.
 */

import { APP_MODULE_LOADERS, isAppId } from './app-registry';
import { isAppAvailable } from './app-preferences';
import type { AppId } from './types';

const initializedApps = new Set<AppId>();
/** Coalesce concurrent ensureAppInitialized calls for the same app. */
const inflightInits = new Map<AppId, Promise<void>>();

/** Initialize a single app page module once. */
export async function ensureAppInitialized(appId: AppId): Promise<void> {
  if (initializedApps.has(appId)) return;
  const inflight = inflightInits.get(appId);
  if (inflight) return inflight;
  if (!isAppAvailable(appId)) return;
  const loader = APP_MODULE_LOADERS[appId];
  if (!loader) return;

  const pending = (async () => {
    const mod = await loader();
    await mod.init();
    initializedApps.add(appId);
  })().finally(() => {
    inflightInits.delete(appId);
  });
  inflightInits.set(appId, pending);
  return pending;
}

function bootAppIdFromHash(hash: string): AppId | null {
  if (!hash.startsWith('#/app/')) return null;
  const segment = hash.slice('#/app/'.length).split('/')[0] ?? '';
  return isAppId(segment) ? segment : null;
}

/** Initialize app modules required for the current hash route at cold boot. */
export async function ensureBootAppsInitialized(): Promise<void> {
  const appId = bootAppIdFromHash(window.location.hash);
  if (appId && isAppAvailable(appId)) {
    await ensureAppInitialized(appId);
  }
}

/** Warm Issues listeners after first paint (badge / embed button). */
export function warmIssuesAppInBackground(): void {
  void ensureAppInitialized('issues');
}

/** Reset lazy-init state (tests). */
export function resetAppModulesForTests(): void {
  initializedApps.clear();
  inflightInits.clear();
}
