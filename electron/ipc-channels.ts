/**
 * Shared IPC channel names for Electron main ↔ preload ↔ renderer.
 * Handlers may be stubs until MIN-112 (WebContentsView preview).
 */

export const PREVIEW_SHOW = 'minnow:preview:show';
export const PREVIEW_HIDE = 'minnow:preview:hide';
export const PREVIEW_LOAD_URL = 'minnow:preview:load-url';
export const PREVIEW_RELOAD = 'minnow:preview:reload';
export const PREVIEW_STOP = 'minnow:preview:stop';
export const PREVIEW_GO_BACK = 'minnow:preview:go-back';
export const PREVIEW_GO_FORWARD = 'minnow:preview:go-forward';
export const PREVIEW_SET_BOUNDS = 'minnow:preview:set-bounds';
/** Main → renderer: navigation occurred in preview host. */
export const PREVIEW_NAVIGATION = 'minnow:preview:navigation';
/** Main → renderer: preview load failed. */
export const PREVIEW_LOAD_FAILED = 'minnow:preview:load-failed';
export const APP_OPEN_EXTERNAL = 'minnow:app:open-external';
