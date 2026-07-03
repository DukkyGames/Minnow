import { scheduleAnimationFrame } from '../lib/schedule-animation-frame';
import { getAppById } from './app-registry';
import {
  CALENDAR_EVENT_EDITOR_INSTANCE_ID,
  CALENDAR_WINDOW_MIN_HEIGHT,
  CALENDAR_WINDOW_MIN_WIDTH,
  centeredCalendarBounds,
} from './calendar-constants';
import type { AppId } from './types';
import { getStageDimensions } from './stage-metrics';
import { mountWindowFrame, type WindowBounds, type WindowFrame } from './window-frame';
import type { SnapMode } from './window-snap';

export const WINDOWS_STORAGE_KEY = 'minnow.os.windows';

export interface OsWindowRecord {
  id: string;
  appId: AppId;
  instanceId: string;
  title: string;
  bounds: WindowBounds;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  snapMode: SnapMode | null;
  /** Bounds before maximize so restore does not read persisted fullscreen size. */
  preMaximizeBounds: WindowBounds | null;
  /** When false, closing the window does not call closeInstance (auxiliary surfaces). */
  manageInstance: boolean;
  /** When false, bounds are not written to localStorage for this window. */
  persistBounds: boolean;
}

interface PersistedWindowState {
  bounds: WindowBounds;
  maximized?: boolean;
  snapMode?: SnapMode | null;
}

type PersistedWindowsMap = Partial<Record<AppId, PersistedWindowState>>;

type WindowListener = (windows: readonly OsWindowRecord[]) => void;

const DEFAULT_BOUNDS: WindowBounds = { x: 80, y: 48, width: 920, height: 640 };

class WindowManager {
  private windows = new Map<string, OsWindowRecord>();
  private frames = new Map<string, WindowFrame>();
  private focusedId: string | null = null;
  private zCounter = 10;
  private listeners = new Set<WindowListener>();
  private layer: HTMLElement | null = null;
  private stageResizeObserver: ResizeObserver | null = null;
  private readonly onStageResize = scheduleAnimationFrame(() => this.reclampWindowsToStage());

  /** Attach to the DOM windows layer (idempotent). */
  ensureLayer(): HTMLElement | null {
    if (this.layer?.isConnected) {
      this.ensureStageResizeObserver();
      return this.layer;
    }
    this.layer = document.getElementById('osWindowsLayer');
    this.ensureStageResizeObserver();
    return this.layer;
  }

  /** Watch stage size so floating windows stay inside the viewport when the shell resizes. */
  private ensureStageResizeObserver(): void {
    if (this.stageResizeObserver) return;
    const stage = document.getElementById('osStage');
    if (!stage || typeof ResizeObserver === 'undefined') return;
    this.stageResizeObserver = new ResizeObserver(() => this.onStageResize());
    this.stageResizeObserver.observe(stage);
  }

  /** Fit all open windows to the current stage viewport. */
  reclampWindowsToStage(): void {
    let anyChanged = false;
    for (const [id, frame] of this.frames) {
      const record = this.windows.get(id);
      if (!record) continue;
      if (!frame.reclampToStage()) continue;
      anyChanged = true;
      record.bounds = frame.getBounds();
      record.snapMode = frame.getSnapMode();
      record.maximized = frame.isMaximized();
      if (record.persistBounds) this.persistBounds(record);
    }
    if (anyChanged) this.emit();
  }

  /** Open or foreground a window for an app instance. */
  open(
    appId: AppId,
    options?: {
      instanceId?: string;
      title?: string;
      bounds?: WindowBounds;
      minWidth?: number;
      minHeight?: number;
      persistBounds?: boolean;
      manageInstance?: boolean;
      /** When false, do not raise/focus an existing or new window (sync paths). Default true. */
      activate?: boolean;
    },
  ): string {
    const layer = this.ensureLayer();
    if (!layer) return '';

    const instanceId = options?.instanceId ?? `win-${appId}`;
    const existing = [...this.windows.values()].find(
      (w) => w.appId === appId && w.instanceId === instanceId,
    );
    if (existing) {
      if (options?.activate !== false) {
        this.focus(existing.id);
        // User-facing open (dock, mini-preview) restores minimized windows.
        if (existing.minimized) this.minimize(existing.id, false);
      }
      return existing.id;
    }

    const app = getAppById(appId);
    const title = options?.title ?? app?.name ?? appId;
    const persistBounds = options?.persistBounds !== false;
    const manageInstance = options?.manageInstance !== false;
    const persisted = persistBounds ? this.loadPersistedBounds(appId) : null;
    const id = `osw-${++this.zCounter}-${appId}`;

    const record: OsWindowRecord = {
      id,
      appId,
      instanceId,
      title,
      bounds:
        options?.bounds ??
        persisted?.bounds ??
        (appId === 'calendar' ? centeredCalendarBounds() : { ...DEFAULT_BOUNDS }),
      zIndex: ++this.zCounter,
      minimized: false,
      maximized: persisted?.maximized ?? false,
      snapMode: persisted?.snapMode ?? null,
      preMaximizeBounds: null,
      manageInstance,
      persistBounds,
    };
    this.windows.set(id, record);

    const frame = mountWindowFrame(layer, {
      windowId: id,
      title,
      bounds: record.bounds,
      minWidth:
        options?.minWidth ??
        (appId === 'calendar' && instanceId !== CALENDAR_EVENT_EDITOR_INSTANCE_ID
          ? CALENDAR_WINDOW_MIN_WIDTH
          : undefined),
      minHeight:
        options?.minHeight ??
        (appId === 'calendar' && instanceId !== CALENDAR_EVENT_EDITOR_INSTANCE_ID
          ? CALENDAR_WINDOW_MIN_HEIGHT
          : undefined),
      maximized: record.maximized,
      snapMode: record.snapMode,
      onFocus: () => {
        this.focus(id);
        if (record.manageInstance) {
          void import('./instances').then(({ focusInstance }) => {
            focusInstance(record.instanceId);
          });
        }
      },
      onClose: () => this.handleCloseRequest(id),
      onMinimize: () => this.minimize(id, true),
      onMaximize: () => this.toggleMaximize(id),
      onBoundsChange: (bounds, meta) => {
        const win = this.windows.get(id);
        if (!win) return;
        win.bounds = bounds;
        win.snapMode = meta.snapMode;
        win.maximized = meta.maximized;
        if (win.persistBounds) this.persistBounds(win);
        this.emit();
      },
    });
    frame.root.style.zIndex = String(record.zIndex);
    this.frames.set(id, frame);
    if (options?.activate !== false) {
      this.focus(id);
    }
    this.emit();
    return id;
  }

  close(windowId: string): void {
    const record = this.windows.get(windowId);
    const frame = this.frames.get(windowId);
    if (!record) return;
    if (frame) {
      record.bounds = frame.getBounds();
      record.snapMode = frame.getSnapMode();
      record.maximized = frame.isMaximized();
    }
    if (record.persistBounds) this.persistBounds(record);
    frame?.destroy();
    this.frames.delete(windowId);
    this.windows.delete(windowId);
    if (this.focusedId === windowId) {
      const remaining = [...this.windows.values()].sort((a, b) => b.zIndex - a.zIndex);
      this.focusedId = remaining[0]?.id ?? null;
      if (this.focusedId) this.focus(this.focusedId);
    }
    this.emit();
  }

  focus(windowId: string): void {
    const record = this.windows.get(windowId);
    const frame = this.frames.get(windowId);
    if (!record || !frame) return;
    if (this.focusedId === windowId) return;

    this.zCounter += 1;
    record.zIndex = this.zCounter;
    frame.root.style.zIndex = String(record.zIndex);
    frame.focus();
    for (const [id, f] of this.frames) {
      if (id !== windowId) f.blur();
    }
    this.focusedId = windowId;
    this.emit();
  }

  minimize(windowId: string, minimized = true): void {
    const record = this.windows.get(windowId);
    const frame = this.frames.get(windowId);
    if (!record || !frame) return;
    record.minimized = minimized;
    frame.setMinimized(minimized);
    this.emit();
  }

  toggleMaximize(windowId: string): void {
    const record = this.windows.get(windowId);
    const frame = this.frames.get(windowId);
    if (!record || !frame) return;

    if (record.maximized) {
      const persisted = this.loadPersistedBounds(record.appId).bounds;
      const restored =
        record.preMaximizeBounds ??
        persisted ??
        (record.appId === 'calendar' ? centeredCalendarBounds() : { ...DEFAULT_BOUNDS });
      record.maximized = false;
      record.snapMode = null;
      record.preMaximizeBounds = null;
      record.bounds = restored;
      frame.setBounds(restored, { snapMode: null, maximized: false });
    } else {
      const stage = document.getElementById('osStage') ?? document.body;
      const { width, height } = getStageDimensions(stage);
      record.preMaximizeBounds = { ...record.bounds };
      record.maximized = true;
      record.snapMode = 'maximize';
      record.bounds = { x: 0, y: 0, width, height };
      frame.setBounds(record.bounds, { snapMode: 'maximize', maximized: true });
    }
    this.persistBounds(record);
    this.emit();
  }

  getWindows(): OsWindowRecord[] {
    return [...this.windows.values()].sort((a, b) => a.zIndex - b.zIndex);
  }

  getFocusedWindowId(): string | null {
    return this.focusedId;
  }

  getFrame(windowId: string): WindowFrame | undefined {
    return this.frames.get(windowId);
  }

  findWindowByInstance(instanceId: string): OsWindowRecord | undefined {
    return [...this.windows.values()].find((w) => w.instanceId === instanceId);
  }

  closeByInstance(instanceId: string): void {
    const win = this.findWindowByInstance(instanceId);
    if (win) this.close(win.id);
  }

  getBodyForInstance(instanceId: string): HTMLElement | null {
    const win = this.findWindowByInstance(instanceId);
    if (!win) return null;
    return this.frames.get(win.id)?.body ?? null;
  }

  subscribe(listener: WindowListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetForTests(): void {
    for (const frame of this.frames.values()) frame.destroy();
    this.windows.clear();
    this.frames.clear();
    this.focusedId = null;
    this.zCounter = 10;
    this.listeners.clear();
    this.stageResizeObserver?.disconnect();
    this.stageResizeObserver = null;
    this.layer = null;
  }

  private handleCloseRequest(windowId: string): void {
    const record = this.windows.get(windowId);
    if (!record) return;
    if (!record.manageInstance) {
      this.close(windowId);
      return;
    }
    void import('./instances').then(({ closeInstance }) => {
      closeInstance(record.instanceId);
    });
  }

  private emit(): void {
    const list = this.getWindows();
    for (const fn of this.listeners) {
      try {
        fn(list);
      } catch {
        /* ignore */
      }
    }
  }

  private loadPersistedBounds(appId: AppId): {
    bounds: WindowBounds | null;
    maximized: boolean;
    snapMode: SnapMode | null;
  } {
    try {
      const raw = localStorage.getItem(WINDOWS_STORAGE_KEY);
      if (!raw) return { bounds: null, maximized: false, snapMode: null };
      const parsed = JSON.parse(raw) as PersistedWindowsMap;
      const entry = parsed[appId];
      if (!entry?.bounds) return { bounds: null, maximized: false, snapMode: null };
      return {
        bounds: { ...entry.bounds },
        maximized: entry.maximized ?? false,
        snapMode: entry.snapMode ?? null,
      };
    } catch {
      return { bounds: null, maximized: false, snapMode: null };
    }
  }

  private persistBounds(record: OsWindowRecord): void {
    if (!record.persistBounds) return;
    try {
      const raw = localStorage.getItem(WINDOWS_STORAGE_KEY);
      const parsed: PersistedWindowsMap = raw ? (JSON.parse(raw) as PersistedWindowsMap) : {};
      parsed[record.appId] = {
        bounds: { ...record.bounds },
        maximized: record.maximized,
        snapMode: record.snapMode,
      };
      localStorage.setItem(WINDOWS_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      /* ignore quota / private mode */
    }
  }
}

export const windowManager = new WindowManager();

export type { WindowBounds };

/** Reset singleton state (tests). */
export function resetWindowManagerForTests(): void {
  windowManager.resetForTests();
}
