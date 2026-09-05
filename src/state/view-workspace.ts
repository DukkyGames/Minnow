/**
 * The workspace folder this renderer is bound to.
 *
 * One SPA renderer serves exactly one workspace, so this is a constant for the
 * life of the page: Electron passes it in through
 * `window.minnow.viewContext.workspacePath`, and every API call stamps it on the
 * wire (`X-Minnow-Workspace` for fetch, `?workspace=` for SSE and WebSocket).
 *
 * `''` means "use the server's persisted global workspace", which is exactly
 * today's single-window behaviour and what the browser, the LAN companion, and
 * the headless CLI all get.
 */

/** Absolute workspace path for this view, or `''` for the server's global. */
export function getViewWorkspacePath(): string {
  if (typeof window === 'undefined') return '';
  const fromBridge = window.minnow?.viewContext?.workspacePath;
  return typeof fromBridge === 'string' ? fromBridge : '';
}

/** Stable id for this view, or `''` outside Electron. */
export function getViewId(): string {
  if (typeof window === 'undefined') return '';
  const fromBridge = window.minnow?.viewContext?.viewId;
  return typeof fromBridge === 'string' ? fromBridge : '';
}

/** True when this SPA runs inside a workspace tab under host chrome. */
export function isHostedView(): boolean {
  if (typeof window === 'undefined') return false;
  return window.minnow?.viewContext?.hosted === true;
}

/** True when this view names its own workspace rather than riding the global. */
export function hasViewWorkspace(): boolean {
  return getViewWorkspacePath().length > 0;
}
