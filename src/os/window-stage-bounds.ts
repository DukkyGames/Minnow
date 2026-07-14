import { getStageDimensions } from './stage-metrics';
import { shouldSuppressDesktopChrome } from './shell-chrome';

export interface WindowStageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const EMPTY_INSETS: WindowStageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Default dock clearance when DOM/CSS metrics are unavailable (tests, early boot). */
const FALLBACK_DOCK_BOTTOM_PX = 132;

/**
 * Bottom inset (px) that floating windows must leave clear when the dock is visible.
 * Maximized / immersive surfaces return 0 because the dock is hidden.
 */
export function getWindowStageInsets(): WindowStageInsets {
  if (shouldSuppressDesktopChrome()) {
    return EMPTY_INSETS;
  }

  const dockShell = document.getElementById('osDockLayer');
  if (!dockShell?.classList.contains('mn-os-dock-shell') || dockShell.hasAttribute('hidden')) {
    return EMPTY_INSETS;
  }

  const inApp = dockShell.dataset.shellView === 'app';
  const dockOpen = dockShell.dataset.dockOpen === 'true';
  if (inApp && !dockOpen) {
    return { ...EMPTY_INSETS, bottom: readRevealTabHeightPx() };
  }

  const measured = measureDockPanelBottomInsetPx();
  if (measured > 0) {
    return { ...EMPTY_INSETS, bottom: measured };
  }

  return { ...EMPTY_INSETS, bottom: readDockBlockFallbackPx() };
}

/** Usable width/height inside the stage after dock (and future) insets. */
export function getWindowStageUsableSize(stage: DOMRect): {
  width: number;
  height: number;
  insets: WindowStageInsets;
} {
  const insets = getWindowStageInsets();
  return {
    width: Math.max(0, stage.width - insets.left - insets.right),
    height: Math.max(0, stage.height - insets.top - insets.bottom),
    insets,
  };
}

/** Measure distance from the dock panel top to the stage bottom. */
function measureDockPanelBottomInsetPx(): number {
  const stage = document.getElementById('osStage');
  const dockLayer = document.getElementById('osDockLayer');
  const panel = dockLayer?.querySelector('.mn-os-dock-panel') as HTMLElement | null;
  if (!stage || !panel) return 0;

  const stageRect = stage.getBoundingClientRect();
  const { height: stageHeight } = getStageDimensions(stage);
  const stageBottom = stageRect.height > 0 ? stageRect.bottom : stageRect.top + stageHeight;
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.height <= 0 || panelRect.top >= stageBottom) return 0;

  return Math.ceil(stageBottom - panelRect.top);
}

/** Read the dock reveal tab height from CSS tokens. */
function readRevealTabHeightPx(): number {
  if (typeof getComputedStyle !== 'function') return 22;
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue('--os-dock-reveal-height').trim();
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 22;
}

/** Fallback dock block height from desktop layer tokens (panel inset + dock block + safe area). */
function readDockBlockFallbackPx(): number {
  if (typeof getComputedStyle !== 'function') {
    return FALLBACK_DOCK_BOTTOM_PX;
  }
  const desktop = document.getElementById('osDesktopLayer');
  const styles = desktop ? getComputedStyle(desktop) : getComputedStyle(document.documentElement);

  const panelInset = parseCssLengthPx(styles.getPropertyValue('--os-dock-panel-inset'), 22);
  const blockHeight = parseCssLengthPx(styles.getPropertyValue('--os-dock-block-height'), 100);
  const safeBottom = parseCssLengthPx(styles.getPropertyValue('--os-safe-bottom'), 0);

  const total = panelInset + blockHeight + safeBottom;
  return total > 0 ? total : FALLBACK_DOCK_BOTTOM_PX;
}

/** Parse a CSS length value to pixels (supports px and rem). */
function parseCssLengthPx(raw: string, fallback: number): number {
  const value = raw.trim();
  if (!value) return fallback;
  if (value.endsWith('rem')) {
    const rem = Number.parseFloat(value);
    if (!Number.isFinite(rem)) return fallback;
    const rootSize =
      typeof getComputedStyle === 'function'
        ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        : 16;
    return rem * rootSize;
  }
  const px = Number.parseFloat(value);
  return Number.isFinite(px) && px > 0 ? px : fallback;
}
