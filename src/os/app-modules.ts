/**
 * Lazy MinnowOS app module initialization — defer page bundles until opened or routed at boot.
 */

import { APP_MODULE_LOADERS, isAppId } from './app-registry';
import type { AppId } from './types';

const initializedApps = new Set<AppId>();
let globalBugsInitialized = false;

/** Initialize a single app page module once. */
export async function ensureAppInitialized(appId: AppId): Promise<void> {
  if (initializedApps.has(appId)) return;
  const loader = APP_MODULE_LOADERS[appId];
  if (!loader) return;
  const mod = await loader();
  await mod.init();
  initializedApps.add(appId);
}

/** Legacy `#/bugs` overlay — not a dock app but still code-split. */
export async function ensureGlobalBugsInitialized(): Promise<void> {
  if (globalBugsInitialized) return;
  const mod = await import('../ui/global-bugs-page');
  mod.initGlobalBugsPage();
  globalBugsInitialized = true;
}

function bootAppIdFromHash(hash: string): AppId | null {
  if (!hash.startsWith('#/app/')) return null;
  const segment = hash.slice('#/app/'.length).split('/')[0] ?? '';
  return isAppId(segment) ? segment : null;
}

function isLegacyBugsHash(hash: string): boolean {
  return hash === '#/bugs' || hash.startsWith('#/bugs/');
}

/** Initialize app modules required for the current hash route at cold boot. */
export async function ensureBootAppsInitialized(): Promise<void> {
  const hash = window.location.hash;
  if (isLegacyBugsHash(hash)) {
    await ensureGlobalBugsInitialized();
    return;
  }

  const appId = bootAppIdFromHash(hash);
  if (appId) {
    await ensureAppInitialized(appId);
  }
}

/** Reset lazy-init state (tests). */
export function resetAppModulesForTests(): void {
  initializedApps.clear();
  globalBugsInitialized = false;
}
