import type { AppId, AppInstance, LaunchOptions, OsView } from './types';

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

/** Foreground app id when view is `app`; otherwise null. */
export function getForegroundAppId(): AppId | null {
  if (view !== 'app' || !foregroundId) return null;
  return instances.find((i) => i.id === foregroundId)?.appId ?? null;
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
  if (view === 'desktop') return;
  view = 'desktop';
  emit();
}

/** Launch or foreground an app; returns the active instance id. */
export function launchInstance(appId: AppId, options?: LaunchOptions): string {
  const existing = instances.find((i) => i.appId === appId);
  if (existing) {
    foregroundId = existing.id;
    if (options?.seed) existing.seed = options.seed;
    existing.unread = 0;
    view = 'app';
    emit();
    return existing.id;
  }

  const inst: AppInstance = {
    id: uid(),
    appId,
    seed: options?.seed,
    unread: 0,
    msg: '',
  };
  instances = [...instances, inst];
  foregroundId = inst.id;
  view = 'app';
  emit();
  return inst.id;
}

/** Foreground a minimized instance and clear its unread badge. */
export function restoreInstance(id: string): boolean {
  const inst = instances.find((i) => i.id === id);
  if (!inst) return false;
  foregroundId = id;
  inst.unread = 0;
  view = 'app';
  emit();
  return true;
}

/** Close an instance; returns to desktop when it was foreground. */
export function closeInstance(id: string): boolean {
  const idx = instances.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  instances = instances.filter((i) => i.id !== id);
  if (foregroundId === id) {
    foregroundId = null;
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

/** Reset module state (tests). */
export function resetInstancesForTests(): void {
  uidCounter = 0;
  view = 'desktop';
  instances = [];
  foregroundId = null;
  listeners.clear();
}
