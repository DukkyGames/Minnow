/**
 * Context usage ring + breakdown DOM targets for Code vs Chat vs desktop composers.
 */

import { getForegroundAppId, getOsView } from '../os/instances';
import { isChatAppForeground } from './chat-mount';

export interface ContextUsageSurface {
  ringId: string;
  breakdownId: string;
}

const SURFACES: Record<'code' | 'chat' | 'desktop', ContextUsageSurface> = {
  code: {
    ringId: 'contextUsageRing',
    breakdownId: 'contextUsageBreakdown',
  },
  chat: {
    ringId: 'chatAppContextUsageRing',
    breakdownId: 'chatAppContextUsageBreakdown',
  },
  desktop: {
    ringId: 'desktopContextRing',
    breakdownId: 'desktopContextBreakdown',
  },
};

function resolveSurfaceKey(): keyof typeof SURFACES {
  const foregroundAppId = getForegroundAppId();
  // Code keeps desktop chat state for return navigation, but Code owns the composer.
  if (foregroundAppId === 'code') return 'code';
  if (false) return 'desktop';
  if (isChatAppForeground()) return 'chat';
  if (getOsView() === 'workspaces' && document.getElementById('desktopContextRing')) return 'desktop';
  return 'code';
}

/** Ring + breakdown ids for the foreground chat surface. */
export function getActiveContextUsageSurface(): ContextUsageSurface {
  return SURFACES[resolveSurfaceKey()];
}

/** All mounted context usage surfaces (Code + Chat + desktop). */
export function listContextUsageSurfaces(): ContextUsageSurface[] {
  return [SURFACES.code, SURFACES.chat, SURFACES.desktop];
}

export function getContextUsageRingButton(
  surface: ContextUsageSurface,
): HTMLButtonElement | null {
  return document.getElementById(surface.ringId) as HTMLButtonElement | null;
}

export function getContextUsageBreakdownPanel(surface: ContextUsageSurface): HTMLElement | null {
  return document.getElementById(surface.breakdownId);
}

export function getContextUsageRingSvg(surface: ContextUsageSurface): SVGSVGElement | null {
  const button = getContextUsageRingButton(surface);
  return button?.querySelector('.context-usage-ring__svg') ?? null;
}
