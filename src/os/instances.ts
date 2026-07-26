import type { AppId, AppInstance, LaunchOptions, OsView, PresentationMode } from './types';
import { resolveInstancePresentation, resolvePresentationMode } from './presentation-mode';
import { windowManager } from './window-manager';

export interface InstanceSnapshot {
  view: OsView;
  instances: readonly AppInstance[];
  foregroundId: string | null;
}

type InstanceListener = (snapshot: InstanceSnapshot) => void;

const listeners = new Set<InstanceListener>();

let uidCounter = 0;
let view: OsView = 'desktop';
let instances: AppInstance[] = [];
let foregroundId: string | null = null;

function uid(): string {
  uidCounter += 1;
  return `inst-${uidCounter}`;
}

function snapshot(): InstanceSnapshot {
  return {
    view,
    instances: [...instances],
    foregroundId,
  };
}

function emit(): void {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Current shell view (desktop launcher vs foreground app). */
export function getOsView(): OsView {
  return view;
}

/** Foreground instance id, if any. */
export function getForegroundInstanceId(): string | null {
  return foregroundId;
}

/** Foreground app id for the focused surface, if any. */
export function getForegroundAppId(): AppId | null {
  if (!foregroundId) return null;
  return instances.find((i) => i.id === foregroundId)?.appId ?? null;
}

/** Presentation mode of the focused surface. */
export function getForegroundPresentationMode(): PresentationMode | null {
  if (!foregroundId) return null;
  const inst = instances.find((i) => i.id === foregroundId);
  return inst ? resolveInstancePresentation(inst) : null;
}

function viewForPresentationMode(mode: PresentationMode): OsView {
  return mode === 'window' || mode === 'sidePanel' || mode === 'desktop' ? 'desktop' : 'app';
}

/**
 * Pick the next foreground after closing `excludeId`.
 * `returnApp` must be captured before the instance is removed from the store.
 */
function pickNextForeground(
  excludeId: string,
  returnApp?: AppId,
  closedPresentation?: ReturnType<typeof resolveInstancePresentation>,
): string | null {
  // returnToApp only applies when closing a fullscreen overlay (e.g. Settings from Code).
  if (returnApp && closedPresentation === 'fullscreen') {
    const target = instances.find((i) => i.appId === returnApp && i.id !== excludeId);
    if (target) {
      const mode = resolveInstancePresentation(target);
      // Honor returnToApp only for floating surfaces — not background fullscreen apps.
      if (mode === 'window' || mode === 'sidePanel') {
        return target.id;
      }
    }
  }

  const remaining = instances.filter((i) => i.id !== excludeId);
  const windowed = remaining.filter((i) => {
    const mode = resolveInstancePresentation(i);
    return mode === 'window' || mode === 'sidePanel';
  });
  // Only rotate among floating surfaces — never resurrect a background fullscreen app
  // (e.g. Code) when the user closes the last window they opened on the desktop.
  if (windowed.length === 0) return null;
  return windowed[windowed.length - 1]?.id ?? null;
}

/** Read-only snapshot for UI renderers. */
export function getInstanceSnapshot(): InstanceSnapshot {
  return snapshot();
}

/** Subscribe to instance/view changes; returns unsubscribe. */
export function subscribeInstances(listener: InstanceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Show the desktop launcher (does not close instances). */
export function showDesktop(): void {
  if (view === 'desktop' && !foregroundId) return;
  view = 'desktop';
  foregroundId = null;
  emit();
}

function applyLaunchOptionsToInstance(inst: AppInstance, options?: LaunchOptions): void {
  if (!options || Object.keys(options).length === 0) return;
  inst.launchOptions = { ...inst.launchOptions, ...options };
  if (options.seed) inst.seed = options.seed;
}

/** Whether a side-panel app should open without stealing the current foreground app. */
function shouldOpenSidePanelAsOverlay(appId: AppId, options?: LaunchOptions): boolean {
  const mode = resolvePresentationMode(appId, options);
  if (mode !== 'sidePanel') return false;
  const fg = getForegroundAppId();
  return fg !== null && fg !== appId;
}

/** Ensure an app instance exists without changing the foreground surface. */
export function ensureBackgroundInstance(appId: AppId, options?: LaunchOptions): string {
  const existing = instances.find((i) => i.appId === appId);
  if (existing) {
    if (options && Object.keys(options).length > 0) {
      applyLaunchOptionsToInstance(existing, options);
    }
    emit();
    return existing.id;
  }

  const inst: AppInstance = {
    id: uid(),
    appId,
    seed: options?.seed,
    launchOptions: options ? { ...options } : undefined,
    unread: 0,
    msg: '',
  };
  instances = [...instances, inst];
  emit();
  return inst.id;
}

/** Launch or foreground an app; returns the active instance id. */
export function launchInstance(appId: AppId, options?: LaunchOptions): string {
  const existing = instances.find((i) => i.appId === appId);
  let resolvedOptions = options;
  if (
    appId === 'settings' &&
    getForegroundAppId() === 'code' &&
    resolvedOptions?.returnToApp == null
  ) {
    resolvedOptions = { ...resolvedOptions, returnToApp: 'code' };
  }

  const overlaySidePanel = shouldOpenSidePanelAsOverlay(appId, resolvedOptions);

  if (existing) {
    if (resolvedOptions && Object.keys(resolvedOptions).length > 0) {
      applyLaunchOptionsToInstance(existing, resolvedOptions);
    }
    if (overlaySidePanel) {
      existing.unread = 0;
      emit();
      return existing.id;
    }
    const mode = resolvePresentationMode(appId, existing.launchOptions);
    foregroundId = existing.id;
    existing.unread = 0;
    view = viewForPresentationMode(mode);
    if (mode === 'window') {
      const win = windowManager.findWindowByInstance(existing.id);
      if (win?.minimized) windowManager.minimize(win.id, false);
    }
    emit();
    return existing.id;
  }

  const mode = resolvePresentationMode(appId, resolvedOptions);
  const inst: AppInstance = {
    id: uid(),
    appId,
    seed: resolvedOptions?.seed,
    launchOptions: resolvedOptions ? { ...resolvedOptions } : undefined,
    unread: 0,
    msg: '',
  };
  instances = [...instances, inst];
  if (overlaySidePanel) {
    emit();
    return inst.id;
  }
  foregroundId = inst.id;
  view = viewForPresentationMode(mode);
  emit();
  return inst.id;
}

/** Foreground a running instance without changing launch options. */
export function focusInstance(id: string): boolean {
  const inst = instances.find((i) => i.id === id);
  if (!inst) return false;
  const nextView = viewForPresentationMode(resolveInstancePresentation(inst));
  if (foregroundId === id && view === nextView) return true;
  foregroundId = id;
  view = nextView;
  emit();
  return true;
}

/** Foreground a minimized instance and clear its unread badge. */
export function restoreInstance(id: string): boolean {
  const inst = instances.find((i) => i.id === id);
  if (!inst) return false;
  foregroundId = id;
  inst.unread = 0;
  view = viewForPresentationMode(resolveInstancePresentation(inst));
  emit();
  return true;
}

/** Close an instance; focuses another open surface or returns to desktop. */
export function closeInstance(id: string): boolean {
  const idx = instances.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  // Read returnToApp before removing — pickNextForeground cannot see the closed row.
  const closing = instances[idx];
  const returnApp = closing?.launchOptions?.returnToApp;
  const closedPresentation = closing
    ? resolveInstancePresentation(closing)
    : undefined;
  const closingOsWindow = Boolean(windowManager.findWindowByInstance(id));
  instances = instances.filter((i) => i.id !== id);
  if (foregroundId === id) {
    foregroundId = pickNextForeground(
      id,
      closingOsWindow ? undefined : returnApp,
      closedPresentation,
    );
    if (!foregroundId) {
      view = 'desktop';
    } else {
      const next = instances.find((i) => i.id === foregroundId);
      view = next ? viewForPresentationMode(resolveInstancePresentation(next)) : 'desktop';
    }
  } else if (instances.length === 0) {
    view = 'desktop';
  }
  emit();
  return true;
}

/** Increment unread for background instances of the same app (agent notifications). */
export function noteAgentMessage(appId: AppId, msg: string): void {
  let changed = false;
  instances = instances.map((inst) => {
    if (inst.appId !== appId) return inst;
    const isFront = view === 'app' && foregroundId === inst.id;
    if (isFront) return inst;
    changed = true;
    return { ...inst, unread: inst.unread + 1, msg };
  });
  if (changed) emit();
}

/** Total unread count across all instances (menubar badge). */
export function getTotalUnread(): number {
  return instances.reduce((sum, i) => sum + i.unread, 0);
}

/** Drop concierge seed on the foreground instance after it has been consumed. */
export function clearForegroundSeed(): void {
  if (!foregroundId) return;
  const inst = instances.find((i) => i.id === foregroundId);
  if (!inst?.seed && !inst?.launchOptions) return;
  inst.seed = undefined;
  inst.launchOptions = undefined;
  emit();
}

/** Clear unread badges on all instances without changing the foreground app. */
export function clearAllUnread(): void {
  const hasUnread = instances.some((i) => i.unread > 0);
  if (!hasUnread) return;
  instances = instances.map((inst) =>
    inst.unread > 0 ? { ...inst, unread: 0 } : inst,
  );
  emit();
}

/** Reset module state (tests). */
export function resetInstancesForTests(): void {
  uidCounter = 0;
  view = 'desktop';
  instances = [];
  foregroundId = null;
  listeners.clear();
}
