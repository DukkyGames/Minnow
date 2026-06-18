import { getPresentationMode } from './app-registry';
import { closeInstance, getInstanceSnapshot } from './instances';
import type { AppId } from './types';

/** Apps whose `<main>` layer mounts inside a floating window frame (not fullscreen). */
export const WINDOW_MOUNTED_APPS = new Set<AppId>([
  'settings',
  'models',
  'brain',
  'bench',
  'compare',
  'calendar',
]);

/** Whether an app renders inside `WindowFrame` when the OS shell is enabled. */
export function isWindowMountedApp(appId: AppId): boolean {
  return WINDOW_MOUNTED_APPS.has(appId);
}

/**
 * Close the foreground instance for a window-mounted app (titlebar X / in-app back).
 * Returns true when the close was handled via the instance store.
 */
export function requestCloseWindowApp(appId: AppId): boolean {
  if (!isWindowMountedApp(appId) || getPresentationMode(appId) !== 'window') {
    return false;
  }
  const snap = getInstanceSnapshot();
  const inst = snap.instances.find((i) => i.appId === appId && i.id === snap.foregroundId);
  if (!inst) return false;
  closeInstance(inst.id);
  return true;
}

type WindowTeardownFn = () => void;
const windowTeardownHandlers = new Map<AppId, WindowTeardownFn>();

/** Register DOM/state cleanup when a window-mounted app instance closes. */
export function registerWindowTeardown(appId: AppId, fn: WindowTeardownFn): void {
  windowTeardownHandlers.set(appId, fn);
}

/** Run registered teardown for a window-mounted app (app-host). */
export function runWindowTeardown(appId: AppId): void {
  windowTeardownHandlers.get(appId)?.();
}
