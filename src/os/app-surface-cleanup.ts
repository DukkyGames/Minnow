/**
 * Close running surfaces for apps the user has turned off.
 */

import {
  closeInstance,
  getForegroundAppId,
  getInstanceSnapshot,
  showWorkspaces,
} from './instances';
import { isAppAvailable } from './app-preferences';
import type { AppId } from './types';

/** DOM-only check so app-preferences does not import the research panel bundle (CSS). */
function isResearchPageOpenForCleanup(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.getElementById('researchView');
  const area = document.getElementById('chatArea');
  if (area?.classList.contains('chat-area--research') && root && area.contains(root)) {
    return true;
  }
  return root?.classList.contains('is-open') ?? false;
}

/**
 * Close instances / overlays for unavailable apps.
 * If the foreground surface was closed, return to the workspace gate.
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

  if (isResearchPageOpenForCleanup() && !isAppAvailable('research')) {
    void import('../research/panel').then((m) => m.closeResearch({ skipNavigate: true }));
    closedForeground = true;
  }

  if (!closedForeground) return;

  showWorkspaces();
  if (typeof window !== 'undefined' && window.location.hash !== '#/workspaces') {
    window.location.hash = '#/workspaces';
  }
}

/** Convenience for callers that know a specific app was just disabled. */
export function closeAppSurfacesIfUnavailable(appId: AppId): void {
  if (isAppAvailable(appId)) return;
  closeUnavailableAppSurfaces();
}
