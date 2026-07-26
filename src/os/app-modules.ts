/**
 * Lazy MinnowOS app module initialization — defer page bundles until opened or routed at boot.
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
  // Do not lazy-init apps the user (or developer gate) has made unavailable.
  if (!isAppAvailable(appId)) return;
  const loader = APP_MODULE_LOADERS[appId];
  if (!loader) return;

  // Mark in-flight before the first await so parallel openers share one init.
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
  // Sidebar Issues button + badge need listeners on every boot.
  await ensureAppInitialized('issues');

  const appId = bootAppIdFromHash(window.location.hash);
  if (appId && isAppAvailable(appId) && appId !== 'issues') {
    await ensureAppInitialized(appId);
  }
}

/** Reset lazy-init state (tests). */
export function resetAppModulesForTests(): void {
  initializedApps.clear();
  inflightInits.clear();
}
