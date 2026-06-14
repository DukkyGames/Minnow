/**
 * Context usage ring + breakdown DOM targets for Code vs Chat composers.
 */

import { isChatAppForeground } from './chat-mount';

export interface ContextUsageSurface {
  ringId: string;
  breakdownId: string;
}

const SURFACES: Record<'code' | 'chat', ContextUsageSurface> = {
  code: {
    ringId: 'contextUsageRing',
    breakdownId: 'contextUsageBreakdown',
  },
  chat: {
    ringId: 'chatAppContextUsageRing',
    breakdownId: 'chatAppContextUsageBreakdown',
  },
};

/** Ring + breakdown ids for the foreground chat surface. */
export function getActiveContextUsageSurface(): ContextUsageSurface {
  return isChatAppForeground() ? SURFACES.chat : SURFACES.code;
}

/** All mounted context usage surfaces (Code + Chat). */
export function listContextUsageSurfaces(): ContextUsageSurface[] {
  return [SURFACES.code, SURFACES.chat];
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
