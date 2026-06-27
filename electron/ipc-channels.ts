/**
 * Shared IPC channel names for Electron main ↔ preload ↔ renderer.
 */

export const PREVIEW_SHOW = 'minnow:preview:show';
export const PREVIEW_HIDE = 'minnow:preview:hide';
export const PREVIEW_CLEAR = 'minnow:preview:clear';
export const PREVIEW_LOAD_URL = 'minnow:preview:load-url';
export const PREVIEW_LOAD_SOURCE = 'minnow:preview:load-source';
export const PREVIEW_RELOAD = 'minnow:preview:reload';
export const PREVIEW_STOP = 'minnow:preview:stop';
export const PREVIEW_GO_BACK = 'minnow:preview:go-back';
export const PREVIEW_GO_FORWARD = 'minnow:preview:go-forward';
export const PREVIEW_SET_BOUNDS = 'minnow:preview:set-bounds';
/** Renderer → main: run JS in the preview guest page context. */
export const PREVIEW_EXEC_JS = 'minnow:preview:exec-js';
/** Renderer → main: capture the preview guest as a base64 PNG. */
export const PREVIEW_CAPTURE_PAGE = 'minnow:preview:capture-page';
/** Renderer → main: current preview guest URL/title/loading. */
export const PREVIEW_GET_INFO = 'minnow:preview:get-info';
/** Renderer → main: load URL and await main-frame finish or fail. */
export const PREVIEW_NAVIGATE_AWAIT = 'minnow:preview:navigate-await';
/** Main → renderer: navigation occurred in preview host. */
export const PREVIEW_NAVIGATION = 'minnow:preview:navigation';
/** Main → renderer: preview guest loading state changed. */
export const PREVIEW_LOADING = 'minnow:preview:loading';
/** Main → renderer: preview guest document title changed. */
export const PREVIEW_PAGE_TITLE = 'minnow:preview:page-title';
/** Main → renderer: preview load failed. */
export const PREVIEW_LOAD_FAILED = 'minnow:preview:load-failed';
export const APP_OPEN_EXTERNAL = 'minnow:app:open-external';
/** Renderer → main: forward renderer errors to crash.jsonl (fire-and-forget). */
export const DIAGNOSTICS_REPORT_ERROR = 'minnow:diagnostics:report-error';
/** Renderer → main: read and clear last renderer crash marker at boot. */
export const DIAGNOSTICS_LAST_CRASH = 'minnow:diagnostics:last-crash';
/** Renderer → main: read OOM pause marker (does not clear). */
export const DIAGNOSTICS_OOM_PAUSE = 'minnow:diagnostics:oom-pause';
/** Renderer → main: clear OOM pause marker after user resumes the board. */
export const DIAGNOSTICS_CLEAR_OOM_PAUSE = 'minnow:diagnostics:clear-oom-pause';
