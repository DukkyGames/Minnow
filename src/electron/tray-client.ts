/**
 * Renderer wrapper for the system-tray bridge.
 */

import type {
  MinnowTrayApi,
  MinnowTrayDesktopState,
  MinnowTrayRendererCommand,
  MinnowTrayStatusSnapshot,
} from '../electron.d.ts';

export type {
  MinnowTrayApi,
  MinnowTrayDesktopState,
  MinnowTrayRendererCommand,
  MinnowTrayStatusSnapshot,
} from '../electron.d.ts';

/** The tray bridge, or null in browser tabs and shells built before the tray feature. */
export function getTrayApi(): MinnowTrayApi | null {
  return window.minnow?.tray ?? null;
}

/** True when desktop shell settings and tray IPC are available. */
export function isTrayBridgeAvailable(): boolean {
  return getTrayApi() != null;
}
