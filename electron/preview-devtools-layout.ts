/**
 * Docked DevTools split math for the preview host (MIN-177).
 *
 * Pure module (no `electron` import) so it can be unit-tested from electron/dist,
 * same pattern as preview-instance-registry.ts. The preview guest and its DevTools
 * WebContentsView share one bounds rect from the renderer (#previewBody); when
 * DevTools is open the guest keeps the top slice and DevTools docks to the bottom.
 */

export interface DevToolsSplitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fraction of the preview height DevTools takes when there is room. */
export const DEVTOOLS_DOCK_RATIO = 0.45;
/** Preferred minimum DevTools height — below this the panels inside DevTools collapse. */
export const DEVTOOLS_MIN_HEIGHT = 160;
/** Minimum height the page keeps above the dock. */
export const GUEST_MIN_HEIGHT = 120;
/** Below this DevTools height the dock is useless — suppress it instead. */
export const DEVTOOLS_SUPPRESS_HEIGHT = 80;

export interface DevToolsSplit {
  guest: DevToolsSplitRect;
  /** null when DevTools is closed or the pane is too short to dock usefully. */
  devtools: DevToolsSplitRect | null;
}

/**
 * Split an already-scaled, integer bounds rect between the page guest (top) and
 * docked DevTools (bottom). Never returns a DevTools slice shorter than
 * DEVTOOLS_SUPPRESS_HEIGHT — a dock that small is unusable, so the guest keeps
 * the full rect (DevTools stays logically open and reappears when the pane grows).
 */
export function splitPreviewBounds(rect: DevToolsSplitRect, devtoolsOpen: boolean): DevToolsSplit {
  if (!devtoolsOpen) {
    return { guest: rect, devtools: null };
  }

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
