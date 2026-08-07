import { closeInstance, getInstanceSnapshot } from './instances';
import type { AppId } from './types';

/** Window-mounted apps were removed; every app is a main-view surface. */
export function isWindowMountedApp(_appId: AppId): boolean {
  return false;
}

/** Close the foreground instance for an app (titlebar X / in-app back). */
export function requestCloseWindowApp(appId: AppId): boolean {
  const snap = getInstanceSnapshot();
  const inst = snap.instances.find((i) => i.appId === appId && i.id === snap.foregroundId);
  if (!inst) return false;
  closeInstance(inst.id);
  return true;
}

type WindowTeardownFn = () => void;
const windowTeardownHandlers = new Map<AppId, WindowTeardownFn>();

/** Register DOM/state cleanup when an app instance closes. */
export function registerWindowTeardown(appId: AppId, fn: WindowTeardownFn): void {
  windowTeardownHandlers.set(appId, fn);
}

/** Run registered teardown for an app when its instance closes. */
export function runWindowTeardown(appId: AppId): void {
  windowTeardownHandlers.get(appId)?.();
}
