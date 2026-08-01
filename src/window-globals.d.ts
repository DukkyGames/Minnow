/**
 * Residual `window` augmentations (dev tooling only).
 * MIN-387 retires UI globals that backed inline index.html handlers.
 */
export {};

import type { ThemeId } from './theme';
import type { MinnowElectronBridge } from './electron';

declare global {
  /** Electron preload bridge (`globalThis.minnow` / `window.minnow`). */
  var minnow: MinnowElectronBridge | undefined;

  interface Window {
    /** Dev-only: `initTheme` assigns `applyTheme` when `import.meta.env.DEV`. */
    __setTheme?: (id: ThemeId) => void;
  }
}
