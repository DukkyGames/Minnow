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
/** Main → renderer: preview guest render process crashed (per-tab; strip stays up). */
export const PREVIEW_GUEST_CRASHED = 'minnow:preview:guest-crashed';
/** Renderer → main: create a preview tab guest; returns tab id. */
export const PREVIEW_TAB_CREATE = 'minnow:preview:tab-create';
/** Renderer → main: close a preview tab guest. */
export const PREVIEW_TAB_CLOSE = 'minnow:preview:tab-close';
/** Renderer → main: activate a preview tab guest. */
export const PREVIEW_TAB_ACTIVATE = 'minnow:preview:tab-activate';
/** Renderer → main: list preview tab guests. */
export const PREVIEW_TAB_LIST = 'minnow:preview:tab-list';
/** Renderer → main: create (or no-op if it exists) a named preview instance. */
export const PREVIEW_INSTANCE_CREATE = 'minnow:preview:instance-create';
/** Renderer → main: destroy a named preview instance and all of its tabs/guests. */
export const PREVIEW_INSTANCE_DESTROY = 'minnow:preview:instance-destroy';
/** Renderer → main: list live preview instance ids for the window (most-recently-used first). */
export const PREVIEW_INSTANCE_LIST = 'minnow:preview:instance-list';
/** Renderer → main: attach CDP + arm native hover/click picking (cross-origin, MIN-370). */
export const PREVIEW_CDP_PICK_ENABLE = 'minnow:preview:cdp-pick-enable';
/** Renderer → main: disarm CDP picking and detach the debugger. */
export const PREVIEW_CDP_PICK_DISABLE = 'minnow:preview:cdp-pick-disable';
/** Main → renderer: a CDP pick landed (adapted to the PickedElement shape). */
export const PREVIEW_CDP_PICK_EVENT = 'minnow:preview:cdp-pick-event';
/** Main → renderer: a non-fatal CDP picking error (session stays alive). */
export const PREVIEW_CDP_PICK_ERROR = 'minnow:preview:cdp-pick-error';
/** Renderer → main: toggle docked DevTools for a preview tab guest (MIN-177). */
export const PREVIEW_DEVTOOLS_TOGGLE = 'minnow:preview:devtools-toggle';
/** Renderer → main: is docked DevTools open for a preview tab guest? */
export const PREVIEW_DEVTOOLS_GET_STATE = 'minnow:preview:devtools-get-state';
/** Renderer → main: dock DevTools below or beside the preview guest. */
export const PREVIEW_DEVTOOLS_SET_DOCK = 'minnow:preview:devtools-set-dock';
/** Renderer → main: read the current DevTools dock position for this window. */
export const PREVIEW_DEVTOOLS_GET_DOCK = 'minnow:preview:devtools-get-dock';
/** Main → renderer: docked DevTools opened/closed (guest shortcut, tab close, crash). */
export const PREVIEW_DEVTOOLS_STATE = 'minnow:preview:devtools-state';
/** Main → renderer: open Minnow-styled preview guest context menu (legacy DOM path). */
export const PREVIEW_CONTEXT_MENU_OPEN = 'minnow:preview:context-menu-open';
/** Main → renderer: user picked a renderer-owned context-menu item (Send to chat, Open in new tab). */
export const PREVIEW_CONTEXT_MENU_SELECT = 'minnow:preview:context-menu-select';
/** Renderer → main: open DevTools + inspectElement at guest coords. */
export const PREVIEW_CONTEXT_INSPECT = 'minnow:preview:context-inspect';
/** Renderer → main: one-shot CDP resolve element at guest coords (Send to chat). */
export const PREVIEW_CONTEXT_RESOLVE_ELEMENT = 'minnow:preview:context-resolve-element';
/** Renderer → main: guest context-menu action (nav / edit / link / image / spellcheck). */
export const PREVIEW_CONTEXT_ACTION = 'minnow:preview:context-action';

export const APP_OPEN_EXTERNAL = 'minnow:app:open-external';
/** Renderer → main: forward renderer errors to crash.jsonl (fire-and-forget). */
export const DIAGNOSTICS_REPORT_ERROR = 'minnow:diagnostics:report-error';
/** Renderer → main: read and clear last renderer crash marker at boot. */
export const DIAGNOSTICS_LAST_CRASH = 'minnow:diagnostics:last-crash';
/** Renderer → main: read OOM pause marker (does not clear). */
export const DIAGNOSTICS_OOM_PAUSE = 'minnow:diagnostics:oom-pause';
/** Renderer → main: clear OOM pause marker after user resumes the board. */
export const DIAGNOSTICS_CLEAR_OOM_PAUSE = 'minnow:diagnostics:clear-oom-pause';

/** Renderer → main: current auto-update status snapshot (MIN-384). */
export const UPDATER_GET_STATUS = 'minnow:updater:get-status';
/** Renderer → main: user-initiated update check (failures surface inline). */
export const UPDATER_CHECK_NOW = 'minnow:updater:check-now';
/** Renderer → main: quit and install the downloaded update. */
export const UPDATER_RESTART = 'minnow:updater:restart';
/** Renderer → main: switch stable/beta release channel and re-check. */
export const UPDATER_SET_CHANNEL = 'minnow:updater:set-channel';
/** Main → renderer: updater status changed. */
export const UPDATER_STATUS_CHANGED = 'minnow:updater:status-changed';

/** Renderer → main: shell window minimize / maximize / close / query maximized. */
export const WINDOW_MINIMIZE = 'minnow:window:minimize';
export const WINDOW_MAXIMIZE = 'minnow:window:maximize';
export const WINDOW_CLOSE = 'minnow:window:close';
export const WINDOW_IS_MAXIMIZED = 'minnow:window:is-maximized';
/** Main → renderer: shell window maximized state changed. */
export const WINDOW_MAXIMIZED_CHANGED = 'minnow:window:maximized-changed';
