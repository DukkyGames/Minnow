/**
 * WebContentsView preview host (MIN-112 / MIN-224 / MIN-364): N named preview
 * *instances* per window (workspace-preview, design, studio-frame:<n>, …),
 * each of which owns its own multi-tab Chromium guest set.
 *
 * Instances are a different axis than tabs: an instance is a parallel named
 * surface (its own host DOM element + bounds); tabs are pages within one
 * surface. All IPC handlers accept an optional trailing `instanceId` that
 * defaults to DEFAULT_PREVIEW_INSTANCE_ID ('workspace-preview') so every
 * existing call site — which never passes one — transparently keeps hitting
 * the single surface that shipped before MIN-364.
 */

import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import * as channels from './ipc-channels.js';
import {
  previewCapturePageBase64,
  previewClearGuest,
  previewExecJs,
  previewGetGuestInfo,
  previewNavigateAwait,
} from './preview-guest-actions.js';
import { PreviewInstanceRegistry, DEFAULT_PREVIEW_INSTANCE_ID } from './preview-instance-registry.js';
import { configurePreviewSession, PREVIEW_SESSION_PARTITION } from './preview-session.js';
import { enableCdpPicking, type CdpPickSession } from './preview-cdp-pick.js';
import { splitPreviewBounds } from './preview-devtools-layout.js';

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Payload from renderer for PREVIEW_LOAD_SOURCE. */
export interface PreviewLoadSourcePayload {
  kind: 'workspace' | 'url';
  path?: string;
  url?: string;
  cacheBust?: number;
}

interface PreviewHostEntry {
  view: WebContentsView;
  visible: boolean;
  /** Docked DevTools view (MIN-177) — non-null while DevTools is open for this tab. */
  devtools: WebContentsView | null;
}

interface WindowPreviewState {
  tabs: Map<string, PreviewHostEntry>;
  activeTabId: string | null;
}

/** windowId → instanceId → { tabs, activeTabId }. Eviction frees native resources; see evictInstanceState. */
const previewInstances = new PreviewInstanceRegistry<WindowPreviewState>({
  createState: () => ({ tabs: new Map(), activeTabId: null }),
  onEvict: (windowId, instanceId, state) => {
    evictInstanceState(windowId, instanceId, state);
  },
});

/** Window-level listeners (did-finish-load / closed) are wired once per window, not per instance. */
const wiredWindowIds = new Set<number>();

/** webContents.id → live CDP picking session (MIN-370). At most one per guest. */
const cdpPickSessions = new Map<number, CdpPickSession>();

/** Last renderer-supplied bounds per (window, instance) — reused when navigating without a fresh show(). */
const lastBoundsByInstance = new Map<string, PreviewBounds>();

function boundsKey(windowId: number, instanceId: string): string {
  return `${windowId}::${instanceId}`;
}

function rememberPreviewBounds(win: BrowserWindow, bounds: PreviewBounds, instanceId?: string): void {
  if (isValidPreviewBounds(bounds)) {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    lastBoundsByInstance.set(boundsKey(win.id, id), bounds);
  }
}

function ensurePreviewSession(): void {
  configurePreviewSession(session.fromPartition(PREVIEW_SESSION_PARTITION));
}

/** Attach window-scoped listeners exactly once, regardless of how many instances the window ends up hosting. */
function ensureWindowWiring(win: BrowserWindow): void {
  if (wiredWindowIds.has(win.id)) return;
  wiredWindowIds.add(win.id);
  win.webContents.on('did-finish-load', () => {
    detachAllInstanceViews(win);
  });
  win.once('closed', () => {
    destroyHostForWindow(win);
  });
}

function windowState(win: BrowserWindow, instanceId?: string): WindowPreviewState {
  ensureWindowWiring(win);
  return previewInstances.ensure(win.id, instanceId);
}

/** Resolve the BrowserWindow that owns an IPC invoke from the renderer. */
function windowFromInvoke(event: IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  return win;
}

/** Send a main → renderer event on the window's primary webContents. */
function sendToRenderer(win: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, ...args);
}

function resolveTabId(win: BrowserWindow, tabId: string | undefined, instanceId?: string): string | null {
  const state = windowState(win, instanceId);
  // Renderer tab ids exist before the main-process guest is created (address bar, loadSource).
  if (typeof tabId === 'string' && tabId.trim()) return tabId.trim();
  // activeTabId may be set by PREVIEW_LOAD_SOURCE / TAB_ACTIVATE before getOrCreateTab runs.
  if (state.activeTabId) return state.activeTabId;
  const first = state.tabs.keys().next().value as string | undefined;
  return first ?? null;
}

/** Deny sensitive permissions in the preview guest by default. */
function attachPermissionHandler(wc: WebContents): void {
  wc.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const denyByDefault = new Set([
      'media',
      'geolocation',
      'notifications',
      'microphone',
      'camera',
    ]);
    callback(!denyByDefault.has(permission));
  });
}

/** Close and detach a tab's docked DevTools view, if any. Safe when already gone. */
function teardownEntryDevTools(win: BrowserWindow | null, entry: PreviewHostEntry): void {
  const dt = entry.devtools;
  if (!dt) return;
  entry.devtools = null;
  if (win && !win.isDestroyed()) {
    try {
      win.contentView.removeChildView(dt);
    } catch {
      /* not attached */
    }
  }
  if (!dt.webContents.isDestroyed()) {
    dt.webContents.close();
  }
}

/** Re-apply the last known bounds so the guest/DevTools split updates without a renderer round-trip. */
function relayoutInstanceEntry(win: BrowserWindow, entry: PreviewHostEntry, instanceId?: string): void {
  if (!entry.visible || win.isDestroyed()) return;
  const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
  const bounds = lastBoundsByInstance.get(boundsKey(win.id, id));
  if (!isValidPreviewBounds(bounds)) return;
  applyPreviewViewBounds(entry, bounds, hostZoomFactor(win));
}

/** Open DevTools docked to the bottom of the preview bounds for one tab guest. */
function openEntryDevTools(
  win: BrowserWindow,
  tabId: string,
  entry: PreviewHostEntry,
  instanceId?: string,
): void {
  if (entry.devtools) return;
  const wc = entry.view.webContents;
  if (wc.isDestroyed() || win.isDestroyed()) return;
  const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
  const devtoolsView = new WebContentsView();
  devtoolsView.setVisible(false);
  entry.devtools = devtoolsView;
  try {
    win.contentView.addChildView(devtoolsView);
  } catch {
    /* window tearing down */
  }
  // setDevToolsWebContents must run before openDevTools; 'detach' renders into our view.
  wc.setDevToolsWebContents(devtoolsView.webContents);
  wc.openDevTools({ mode: 'detach', activate: false });
  relayoutInstanceEntry(win, entry, id);
  sendToRenderer(win, channels.PREVIEW_DEVTOOLS_STATE, tabId, true, id);
}

/** Forward guest navigation / load lifecycle to the Minnow renderer (instanceId lets multi-surface listeners filter). */
function wirePreviewGuestEvents(win: BrowserWindow, tabId: string, entry: PreviewHostEntry, instanceId: string): void {
  const wc = entry.view.webContents;
  let suppressNavigationUntilFailHandled = false;

  const emitNavigation = (url: string): void => {
    if (suppressNavigationUntilFailHandled) return;
    sendToRenderer(win, channels.PREVIEW_NAVIGATION, tabId, url, instanceId);
  };

  wc.on('did-start-loading', () => {
    suppressNavigationUntilFailHandled = false;
    sendToRenderer(win, channels.PREVIEW_LOADING, tabId, true, instanceId);
  });

  wc.on('did-stop-loading', () => {
    sendToRenderer(win, channels.PREVIEW_LOADING, tabId, false, instanceId);
    if (!suppressNavigationUntilFailHandled) {
      emitNavigation(wc.getURL());
    }
  });

  wc.on('did-navigate', (_event, url) => {
    emitNavigation(url);
  });

  wc.on('did-navigate-in-page', (_event, url) => {
    emitNavigation(url);
  });

  wc.on('page-title-updated', (_event, title) => {
    sendToRenderer(win, channels.PREVIEW_PAGE_TITLE, tabId, title, instanceId);
  });

  wc.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return;
      suppressNavigationUntilFailHandled = true;
      sendToRenderer(win, channels.PREVIEW_LOADING, tabId, false, instanceId);
      sendToRenderer(win, channels.PREVIEW_LOAD_FAILED, tabId, {
        errorCode,
        errorDescription,
        url: validatedURL,
      }, instanceId);
    },
  );

  wc.setWindowOpenHandler(({ url }) => {
    if (url) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  wc.on('render-process-gone', (_event, details) => {
    handleTabGuestCrash(win, tabId, details.reason, details.exitCode, instanceId);
  });

  // F12 / Ctrl+Shift+I / Cmd+Opt+I inside the page toggles docked DevTools (MIN-177).
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const combo =
      input.key === 'F12' ||
      (input.control && input.shift && key === 'i') ||
      (input.meta && input.alt && key === 'i');
    if (!combo) return;
    event.preventDefault();
    if (entry.devtools) {
      wc.closeDevTools();
    } else {
      openEntryDevTools(win, tabId, entry, instanceId);
    }
  });

  // Fires for closeDevTools() and any devtools-internal close; single teardown path.
  wc.on('devtools-closed', () => {
    if (!entry.devtools) return;
    teardownEntryDevTools(win.isDestroyed() ? null : win, entry);
    relayoutInstanceEntry(win, entry, instanceId);
    sendToRenderer(win, channels.PREVIEW_DEVTOOLS_STATE, tabId, false, instanceId);
  });
}

/** Detach a guest view from its window and close its WebContents. Safe to call on an already-torn-down window. */
function destroyGuestEntry(win: BrowserWindow | null, entry: PreviewHostEntry): void {
  teardownEntryDevTools(win, entry);
  if (win && !win.isDestroyed()) {
    try {
      win.contentView.removeChildView(entry.view);
    } catch {
      /* already detached */
    }
  }
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close();
  }
}

/** Tear down a crashed guest without switching the active tab or closing renderer tabs. */
function handleTabGuestCrash(
  win: BrowserWindow,
  tabId: string,
  reason: string,
  exitCode: number,
  instanceId?: string,
): void {
  const state = previewInstances.get(win.id, instanceId);
  const entry = state?.tabs.get(tabId);
  if (!entry || !state) return;

  state.tabs.delete(tabId);
  destroyGuestEntry(win, entry);

  sendToRenderer(win, channels.PREVIEW_GUEST_CRASHED, tabId, {
    reason,
    exitCode,
  }, PreviewInstanceRegistry.resolveInstanceId(instanceId));
}

function destroyTabGuest(win: BrowserWindow, tabId: string, instanceId?: string): void {
  const state = windowState(win, instanceId);
  const entry = state.tabs.get(tabId);
  if (!entry) return;
  state.tabs.delete(tabId);
  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs.keys().next().value ?? null;
  }
  destroyGuestEntry(win, entry);
}

/** Registry eviction callback: free native resources for an idle instance; the registry has already dropped it. */
function evictInstanceState(windowId: number, instanceId: string, state: WindowPreviewState): void {
  const win = BrowserWindow.fromId(windowId);
  for (const entry of state.tabs.values()) {
    destroyGuestEntry(win && !win.isDestroyed() ? win : null, entry);
  }
  lastBoundsByInstance.delete(boundsKey(windowId, instanceId));
}

function destroyInstance(win: BrowserWindow, instanceId?: string): void {
  const state = previewInstances.delete(win.id, instanceId);
  if (!state) return;
  for (const entry of state.tabs.values()) {
    destroyGuestEntry(win, entry);
  }
  lastBoundsByInstance.delete(boundsKey(win.id, PreviewInstanceRegistry.resolveInstanceId(instanceId)));
}

function destroyHostForWindow(win: BrowserWindow): void {
  const removed = previewInstances.deleteWindow(win.id);
  for (const [, state] of removed) {
    for (const entry of state.tabs.values()) {
      destroyGuestEntry(win.isDestroyed() ? null : win, entry);
    }
  }
  for (const key of [...lastBoundsByInstance.keys()]) {
    if (key.startsWith(`${win.id}::`)) lastBoundsByInstance.delete(key);
  }
  wiredWindowIds.delete(win.id);
}

async function loadSourceInGuest(
  wc: WebContents,
  payload: PreviewLoadSourcePayload,
): Promise<void> {
  const url = payload.url?.trim();
  if (!url) return;
  await wc.loadURL(url);
}

function roundBounds(bounds: PreviewBounds): { x: number; y: number; width: number; height: number } {
  const w = Math.max(0, Math.round(bounds.width));
  const h = Math.max(0, Math.round(bounds.height));
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: w,
    height: h,
  };
}

function isValidPreviewBounds(bounds: PreviewBounds | undefined): bounds is PreviewBounds {
  if (!bounds) return false;
  const { x, y, width, height } = bounds;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

function hostZoomFactor(win: BrowserWindow | null): number {
  if (!win || win.isDestroyed()) return 1;
  try {
    const z = win.webContents.getZoomFactor();
    return Number.isFinite(z) && z > 0 ? z : 1;
  } catch {
    return 1;
  }
}

function applyPreviewViewBounds(
  entry: PreviewHostEntry,
  bounds: PreviewBounds,
  zoomFactor: number,
): boolean {
  const rounded = roundBounds({
    x: bounds.x * zoomFactor,
    y: bounds.y * zoomFactor,
    width: bounds.width * zoomFactor,
    height: bounds.height * zoomFactor,
  });
  if (rounded.width <= 0 || rounded.height <= 0) {
    entry.visible = false;
    entry.view.setVisible(false);
    entry.devtools?.setVisible(false);
    return false;
  }
  const split = splitPreviewBounds(rounded, Boolean(entry.devtools));
  entry.view.setBounds(split.guest);
  entry.visible = true;
  entry.view.setVisible(true);
  if (entry.devtools) {
    if (split.devtools) {
      entry.devtools.setBounds(split.devtools);
      entry.devtools.setVisible(true);
    } else {
      // Pane too short to dock usefully — DevTools stays open, reappears when it grows.
      entry.devtools.setVisible(false);
      entry.devtools.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
  return true;
}

function hidePreviewHostEntry(entry: PreviewHostEntry): void {
  entry.visible = false;
  entry.view.setVisible(false);
  entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  if (entry.devtools) {
    entry.devtools.setVisible(false);
    entry.devtools.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

/** Hide + detach every tab view belonging to a single instance. */
function detachAllTabViews(win: BrowserWindow, instanceId?: string): void {
  const state = previewInstances.get(win.id, instanceId);
  if (!state) return;
  for (const entry of state.tabs.values()) {
    hidePreviewHostEntry(entry);
    try {
      win.contentView.removeChildView(entry.view);
    } catch {
      /* not attached */
    }
    if (entry.devtools) {
      try {
        win.contentView.removeChildView(entry.devtools);
      } catch {
        /* not attached */
      }
    }
  }
}

/** Hide + detach every tab view across every instance of a window (e.g. on renderer reload). */
function detachAllInstanceViews(win: BrowserWindow): void {
  for (const instanceId of previewInstances.listInstanceIds(win.id)) {
    detachAllTabViews(win, instanceId);
  }
}

function createTabGuest(win: BrowserWindow, tabId: string, instanceId: string): PreviewHostEntry {
  ensurePreviewSession();
  const view = new WebContentsView({
    webPreferences: {
      partition: PREVIEW_SESSION_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  view.setVisible(false);
  attachPermissionHandler(view.webContents);
  const entry: PreviewHostEntry = { view, visible: false, devtools: null };
  wirePreviewGuestEvents(win, tabId, entry, instanceId);
  return entry;
}

function getOrCreateTab(win: BrowserWindow, tabId: string, instanceId?: string): PreviewHostEntry {
  const state = windowState(win, instanceId);
  const existing = state.tabs.get(tabId);
  if (existing) return existing;
  const entry = createTabGuest(win, tabId, PreviewInstanceRegistry.resolveInstanceId(instanceId));
  state.tabs.set(tabId, entry);
  return entry;
}

function showActiveTab(win: BrowserWindow, bounds?: PreviewBounds, instanceId?: string): PreviewHostEntry | null {
  const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
  const state = windowState(win, id);
  const tabId = resolveTabId(win, state.activeTabId ?? undefined, id);
  if (!tabId) return null;
  const entry = getOrCreateTab(win, tabId, id);
  detachAllTabViews(win, id);
  const key = boundsKey(win.id, id);
  const effectiveBounds = isValidPreviewBounds(bounds) ? bounds : lastBoundsByInstance.get(key);
  const hasBounds = isValidPreviewBounds(effectiveBounds);
  if (hasBounds) {
    applyPreviewViewBounds(entry, effectiveBounds!, hostZoomFactor(win));
    rememberPreviewBounds(win, effectiveBounds!, id);
  } else {
    entry.visible = false;
    entry.view.setVisible(false);
  }
  try {
    win.contentView.addChildView(entry.view);
  } catch {
    /* already attached */
  }
  if (entry.devtools) {
    try {
      win.contentView.addChildView(entry.devtools);
    } catch {
      /* already attached */
    }
  }
  state.activeTabId = tabId;
  previewInstances.setVisible(win.id, id, hasBounds);
  return entry;
}

function getActiveEntry(event: IpcMainInvokeEvent, tabId?: string, instanceId?: string): PreviewHostEntry | null {
  const win = windowFromInvoke(event);
  if (!win) return null;
  if (typeof tabId === 'string' && tabId.trim()) {
    return getOrCreateTab(win, tabId.trim(), instanceId);
  }
  const resolved = resolveTabId(win, undefined, instanceId);
  if (!resolved) return null;
  return getOrCreateTab(win, resolved, instanceId);
}

/** Register preview IPC handlers (replaces main.ts stubs). */
export function registerPreviewHostIpc(): void {
  ipcMain.handle(channels.PREVIEW_TAB_CREATE, (event, tabId?: string, instanceId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return null;
    const id = typeof tabId === 'string' && tabId.trim() ? tabId.trim() : randomUUID();
    getOrCreateTab(win, id, instanceId);
    const state = windowState(win, instanceId);
    if (!state.activeTabId) state.activeTabId = id;
    return id;
  });

  ipcMain.handle(channels.PREVIEW_TAB_CLOSE, (event, tabId: string, instanceId?: string) => {
    const win = windowFromInvoke(event);
    if (!win || typeof tabId !== 'string') return;
    destroyTabGuest(win, tabId, instanceId);
  });

  ipcMain.handle(channels.PREVIEW_TAB_ACTIVATE, (event, tabId: string, instanceId?: string) => {
    const win = windowFromInvoke(event);
    if (!win || typeof tabId !== 'string') return;
    const state = windowState(win, instanceId);
    if (!state.tabs.has(tabId)) getOrCreateTab(win, tabId, instanceId);
    state.activeTabId = tabId;
    showActiveTab(win, undefined, instanceId);
  });

  ipcMain.handle(channels.PREVIEW_TAB_LIST, (event, instanceId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return [];
    const state = windowState(win, instanceId);
    return [...state.tabs.entries()].map(([id, entry]) => {
      const info = previewGetGuestInfo(entry.view.webContents);
      return {
        id,
        url: info.url,
        title: info.title,
        loading: info.loading,
        active: id === state.activeTabId,
      };
    });
  });

  ipcMain.handle(
    channels.PREVIEW_INSTANCE_CREATE,
    (event, instanceId?: string) => {
      const win = windowFromInvoke(event);
      if (!win) return null;
      windowState(win, instanceId);
      return PreviewInstanceRegistry.resolveInstanceId(instanceId);
    },
  );

  ipcMain.handle(channels.PREVIEW_INSTANCE_DESTROY, (event, instanceId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return;
    destroyInstance(win, instanceId);
  });

  ipcMain.handle(channels.PREVIEW_INSTANCE_LIST, (event) => {
    const win = windowFromInvoke(event);
    if (!win) return [];
    return previewInstances.listInstanceIds(win.id);
  });

  ipcMain.handle(
    channels.PREVIEW_SHOW,
    (event, bounds?: PreviewBounds, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      if (!win) return;
      const state = windowState(win, instanceId);
      if (tabId && typeof tabId === 'string') {
        state.activeTabId = tabId;
      }
      if (bounds && isValidPreviewBounds(bounds)) {
        rememberPreviewBounds(win, bounds, instanceId);
      }
      showActiveTab(win, bounds, instanceId);
    },
  );

  ipcMain.handle(channels.PREVIEW_HIDE, (event, tabId?: string, instanceId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return;
    if (tabId && typeof tabId === 'string') {
      const state = previewInstances.get(win.id, instanceId);
      const entry = state?.tabs.get(tabId);
      if (entry) hidePreviewHostEntry(entry);
      return;
    }
    detachAllTabViews(win, instanceId);
    previewInstances.setVisible(win.id, instanceId, false);
  });

  ipcMain.handle(channels.PREVIEW_CLEAR, async (event, tabId?: string, instanceId?: string) => {
    const entry = getActiveEntry(event, tabId, instanceId);
    if (!entry) return;
    try {
      await previewClearGuest(entry.view.webContents);
    } catch (err) {
      console.warn('[preview] clear failed:', err instanceof Error ? err.message : err);
    }
  });

  ipcMain.handle(
    channels.PREVIEW_LOAD_SOURCE,
    (event, payload: PreviewLoadSourcePayload, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry || !win || !payload || typeof payload !== 'object') return;
      if (tabId && typeof tabId === 'string') {
        windowState(win, instanceId).activeTabId = tabId;
      }
      // Do not call showActiveTab here — it detaches the guest and clears bounds mid-navigation.
      void loadSourceInGuest(entry.view.webContents, payload).catch((err) => {
        if (!win) return;
        const message = err instanceof Error ? err.message : String(err);
        const id = resolveTabId(win, tabId, instanceId) ?? 'unknown';
        sendToRenderer(win, channels.PREVIEW_LOAD_FAILED, id, {
          errorCode: -2,
          errorDescription: message,
          url: payload.kind === 'url' ? payload.url : payload.path,
        }, PreviewInstanceRegistry.resolveInstanceId(instanceId));
      });
    },
  );

  ipcMain.handle(
    channels.PREVIEW_LOAD_URL,
    (event, url: string, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry || typeof url !== 'string' || !url.trim()) return;
      if (win && tabId && typeof tabId === 'string') {
        windowState(win, instanceId).activeTabId = tabId;
      }
      void entry.view.webContents.loadURL(url);
    },
  );

  ipcMain.handle(channels.PREVIEW_RELOAD, (event, tabId?: string, instanceId?: string) => {
    const entry = getActiveEntry(event, tabId, instanceId);
    if (!entry) return;
    const wc = entry.view.webContents;
    if (wc.isLoading()) wc.stop();
    wc.reload();
  });

  ipcMain.handle(channels.PREVIEW_STOP, (event, tabId?: string, instanceId?: string) => {
    const entry = getActiveEntry(event, tabId, instanceId);
    if (!entry) return;
    entry.view.webContents.stop();
  });

  ipcMain.handle(channels.PREVIEW_GO_BACK, (event, tabId?: string, instanceId?: string) => {
    const entry = getActiveEntry(event, tabId, instanceId);
    const wc = entry?.view.webContents;
    if (!wc?.canGoBack()) return;
    wc.goBack();
  });

  ipcMain.handle(channels.PREVIEW_GO_FORWARD, (event, tabId?: string, instanceId?: string) => {
    const entry = getActiveEntry(event, tabId, instanceId);
    const wc = entry?.view.webContents;
    if (!wc?.canGoForward()) return;
    wc.goForward();
  });

  ipcMain.handle(
    channels.PREVIEW_SET_BOUNDS,
    (event, bounds: PreviewBounds, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry || !bounds || !win) return;
      if (!isValidPreviewBounds(bounds)) {
        const { width, height } = bounds;
        if (Number.isFinite(width) && Number.isFinite(height) && (width <= 0 || height <= 0)) {
          entry.view.setVisible(false);
          entry.visible = false;
        }
        return;
      }
      applyPreviewViewBounds(entry, bounds, hostZoomFactor(win));
      rememberPreviewBounds(win, bounds, instanceId);
    },
  );

  ipcMain.handle(
    channels.PREVIEW_EXEC_JS,
    async (event, code: string, tabId?: string, instanceId?: string) => {
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry || typeof code !== 'string') {
        throw new Error('Preview guest is not available');
      }
      return previewExecJs(entry.view.webContents, code);
    },
  );

  ipcMain.handle(
    channels.PREVIEW_CAPTURE_PAGE,
    async (event, tabId?: string, instanceId?: string) => {
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry) {
        throw new Error('Preview guest is not available');
      }
      return previewCapturePageBase64(entry.view.webContents);
    },
  );

  ipcMain.handle(channels.PREVIEW_GET_INFO, (event, tabId?: string, instanceId?: string) => {
    const entry = getActiveEntry(event, tabId, instanceId);
    if (!entry) {
      return { url: '', title: '', loading: false };
    }
    return previewGetGuestInfo(entry.view.webContents);
  });

  ipcMain.handle(
    channels.PREVIEW_NAVIGATE_AWAIT,
    async (event, url: string, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry) {
        return {
          ok: false,
          url: typeof url === 'string' ? url : '',
          title: '',
          errorDescription: 'Preview guest is not available',
        };
      }
      if (win && tabId && typeof tabId === 'string') {
        windowState(win, instanceId).activeTabId = tabId;
        showActiveTab(win, undefined, instanceId);
      }
      if (typeof url !== 'string') {
        return previewNavigateAwait(entry.view.webContents, '');
      }
      return previewNavigateAwait(entry.view.webContents, url);
    },
  );

  ipcMain.handle(
    channels.PREVIEW_CDP_PICK_ENABLE,
    async (event, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry || !win) {
        return { ok: false, error: 'Preview guest is not available' };
      }
      const wc = entry.view.webContents;
      if (cdpPickSessions.has(wc.id)) {
        return { ok: true };
      }
      try {
        const session = await enableCdpPicking(
          wc,
          (picked) => {
            if (win.isDestroyed()) return;
            win.webContents.send(channels.PREVIEW_CDP_PICK_EVENT, picked, tabId, instanceId);
          },
          (message) => {
            if (win.isDestroyed()) return;
            win.webContents.send(channels.PREVIEW_CDP_PICK_ERROR, message, tabId, instanceId);
          },
        );
        cdpPickSessions.set(wc.id, session);
        wc.once('destroyed', () => {
          cdpPickSessions.delete(wc.id);
        });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    channels.PREVIEW_DEVTOOLS_TOGGLE,
    (event, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      if (!win) return { open: false };
      const resolved = resolveTabId(win, tabId, instanceId);
      if (!resolved) return { open: false };
      const entry = getOrCreateTab(win, resolved, instanceId);
      if (entry.devtools) {
        entry.view.webContents.closeDevTools();
        return { open: false };
      }
      openEntryDevTools(win, resolved, entry, instanceId);
      return { open: Boolean(entry.devtools) };
    },
  );

  ipcMain.handle(
    channels.PREVIEW_DEVTOOLS_GET_STATE,
    (event, tabId?: string, instanceId?: string) => {
      const win = windowFromInvoke(event);
      if (!win) return false;
      const state = previewInstances.get(win.id, instanceId);
      if (!state) return false;
      const id = typeof tabId === 'string' && tabId.trim() ? tabId.trim() : state.activeTabId;
      const entry = id ? state.tabs.get(id) : undefined;
      return Boolean(entry?.devtools);
    },
  );

  ipcMain.handle(
    channels.PREVIEW_CDP_PICK_DISABLE,
    async (event, tabId?: string, instanceId?: string) => {
      const entry = getActiveEntry(event, tabId, instanceId);
      if (!entry) return;
      const wc = entry.view.webContents;
      const session = cdpPickSessions.get(wc.id);
      if (!session) return;
      cdpPickSessions.delete(wc.id);
      await session.disable();
    },
  );
}

/** Tear down all preview hosts (app quit). */
export function destroyAllPreviewHosts(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    destroyHostForWindow(win);
  }
}

export { DEFAULT_PREVIEW_INSTANCE_ID };
