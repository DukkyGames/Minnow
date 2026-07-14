/**
 * Residual `window` augmentations (dev tooling only).
 * MIN-387 retires UI globals that backed inline index.html handlers.
 */
export {};

import type { ThemeId } from './theme';

declare global {
  interface Window {
    /** Dev-only: `initTheme` assigns `applyTheme` when `import.meta.env.DEV`. */
    __setTheme?: (id: ThemeId) => void;
  }
}
