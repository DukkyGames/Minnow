/**
 * Docked DevTools split math for the preview host (MIN-177).
 *
 * Pure module (no `electron` import) so it can be unit-tested from electron/dist,
 * same pattern as preview-instance-registry.ts. The preview guest and its DevTools
 * WebContentsView share one bounds rect from the renderer (#previewBody); when
 * DevTools is open the guest and DevTools split that rect (bottom or right side).
 */

export interface DevToolsSplitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where DevTools attaches relative to the preview guest. */
export type DevToolsDockPosition = 'bottom' | 'side' | 'popout';

/** Fraction of the preview axis DevTools takes when there is room. */
export const DEVTOOLS_DOCK_RATIO = 0.45;
/** Preferred minimum DevTools height — below this the panels inside DevTools collapse. */
export const DEVTOOLS_MIN_HEIGHT = 160;
/** Minimum height the page keeps above a bottom dock. */
export const GUEST_MIN_HEIGHT = 120;
/** Below this DevTools height the bottom dock is useless — suppress it instead. */
export const DEVTOOLS_SUPPRESS_HEIGHT = 80;
/** Preferred minimum DevTools width for a side dock. */
export const DEVTOOLS_MIN_WIDTH = 200;
/** Minimum width the page keeps beside a side dock. */
export const GUEST_MIN_WIDTH = 200;
/** Below this DevTools width the side dock is useless — suppress it instead. */
export const DEVTOOLS_SUPPRESS_WIDTH = 80;

export interface DevToolsSplit {
  guest: DevToolsSplitRect;
  /** null when DevTools is closed or the pane is too short to dock usefully. */
  devtools: DevToolsSplitRect | null;
}

function splitBottomDock(rect: DevToolsSplitRect): DevToolsSplit {
  let devtoolsHeight = Math.max(DEVTOOLS_MIN_HEIGHT, Math.round(rect.height * DEVTOOLS_DOCK_RATIO));
  if (devtoolsHeight > rect.height - GUEST_MIN_HEIGHT) {
    devtoolsHeight = rect.height - GUEST_MIN_HEIGHT;
  }
  if (devtoolsHeight < DEVTOOLS_SUPPRESS_HEIGHT) {
    return { guest: rect, devtools: null };
  }

  const guestHeight = rect.height - devtoolsHeight;
  return {
    guest: { x: rect.x, y: rect.y, width: rect.width, height: guestHeight },
    devtools: {
      x: rect.x,
      y: rect.y + guestHeight,
      width: rect.width,
      height: devtoolsHeight,
    },
  };
}

function splitSideDock(rect: DevToolsSplitRect): DevToolsSplit {
  let devtoolsWidth = Math.max(DEVTOOLS_MIN_WIDTH, Math.round(rect.width * DEVTOOLS_DOCK_RATIO));
  if (devtoolsWidth > rect.width - GUEST_MIN_WIDTH) {
    devtoolsWidth = rect.width - GUEST_MIN_WIDTH;
  }
  if (devtoolsWidth < DEVTOOLS_SUPPRESS_WIDTH) {
    return { guest: rect, devtools: null };
  }

  const guestWidth = rect.width - devtoolsWidth;
  return {
    guest: { x: rect.x, y: rect.y, width: guestWidth, height: rect.height },
    devtools: {
      x: rect.x + guestWidth,
      y: rect.y,
      width: devtoolsWidth,
      height: rect.height,
    },
  };
}

/**
 * Split an already-scaled, integer bounds rect between the page guest and docked DevTools.
 * Never returns a DevTools slice shorter/narrower than the suppress thresholds — a dock that
 * small is unusable, so the guest keeps the full rect (DevTools stays logically open and
 * reappears when the pane grows).
 */
export function splitPreviewBounds(
  rect: DevToolsSplitRect,
  devtoolsOpen: boolean,
  dock: DevToolsDockPosition = 'bottom',
): DevToolsSplit {
  if (!devtoolsOpen) {
    return { guest: rect, devtools: null };
  }

  if (dock === 'popout') {
    return { guest: rect, devtools: null };
  }

  return dock === 'side' ? splitSideDock(rect) : splitBottomDock(rect);
}
