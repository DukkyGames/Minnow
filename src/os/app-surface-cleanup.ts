/**
 * Close running surfaces for apps the user has turned off.
 */

import {
  deactivateDesktopExperts,
  deactivateDesktopResearch,
  isDesktopExpertsActive,
  isDesktopResearchActive,
} from './desktop-state';
import {
  closeInstance,
  getForegroundAppId,
  getInstanceSnapshot,
  showDesktop,
} from './instances';
import { isAppAvailable } from './app-preferences';
import type { AppId } from './types';

/**
 * Close instances / desktop overlays for unavailable apps.
 * If the foreground surface was closed, return to the desktop.
 */
export function closeUnavailableAppSurfaces(): void {
  const snap = getInstanceSnapshot();
  const foregroundApp = getForegroundAppId();
  let closedForeground = Boolean(foregroundApp && !isAppAvailable(foregroundApp));

  for (const inst of [...snap.instances]) {
    if (isAppAvailable(inst.appId)) continue;
    if (inst.appId === foregroundApp) closedForeground = true;
    closeInstance(inst.id);
  }

  if (isDesktopResearchActive() && !isAppAvailable('research')) {
    deactivateDesktopResearch();
    closedForeground = true;
  }

  if (isDesktopExpertsActive() && !isAppAvailable('experts')) {
    deactivateDesktopExperts();
    closedForeground = true;
  }

  if (!closedForeground) return;

  showDesktop();
  if (typeof window !== 'undefined' && window.location.hash !== '#/desktop') {
    window.location.hash = '#/desktop';
  }
}

/** Convenience for callers that know a specific app was just disabled. */
export function closeAppSurfacesIfUnavailable(appId: AppId): void {
  if (isAppAvailable(appId)) return;
  closeUnavailableAppSurfaces();
}
