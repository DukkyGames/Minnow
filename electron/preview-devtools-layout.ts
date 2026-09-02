export interface DevToolsSplitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DevToolsDockPosition = 'bottom' | 'side' | 'popout';

export const DEVTOOLS_DOCK_RATIO = 0.45;
export const DEVTOOLS_MIN_HEIGHT = 160;
export const GUEST_MIN_HEIGHT = 120;
export const DEVTOOLS_SUPPRESS_HEIGHT = 80;
export const DEVTOOLS_MIN_WIDTH = 200;
export const GUEST_MIN_WIDTH = 200;
export const DEVTOOLS_SUPPRESS_WIDTH = 80;

export interface DevToolsSplit {
  guest: DevToolsSplitRect;
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
