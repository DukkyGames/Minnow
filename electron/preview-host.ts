/**
 * WebContentsView preview host (MIN-112 / MIN-224): multi-tab Chromium guests per window.
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
import { configurePreviewSession, PREVIEW_SESSION_PARTITION } from './preview-session.js';

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
}

interface WindowPreviewState {
  tabs: Map<string, PreviewHostEntry>;
  activeTabId: string | null;
}

const hostsByWindowId = new Map<number, WindowPreviewState>();

function ensurePreviewSession(): void {
  configurePreviewSession(session.fromPartition(PREVIEW_SESSION_PARTITION));
}

function windowState(win: BrowserWindow): WindowPreviewState {
  let state = hostsByWindowId.get(win.id);
  if (!state) {
    state = { tabs: new Map(), activeTabId: null };
    hostsByWindowId.set(win.id, state);
    win.webContents.on('did-finish-load', () => {
      detachAllTabViews(win);
    });
    win.once('closed', () => {
      destroyHostForWindow(win);
    });
  }
  return state;
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

function resolveTabId(win: BrowserWindow, tabId?: string): string | null {
  const state = windowState(win);
  if (tabId && state.tabs.has(tabId)) return tabId;
  if (state.activeTabId && state.tabs.has(state.activeTabId)) return state.activeTabId;
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

/** Forward guest navigation / load lifecycle to the Minnow renderer. */
function wirePreviewGuestEvents(win: BrowserWindow, tabId: string, wc: WebContents): void {
  let suppressNavigationUntilFailHandled = false;

  const emitNavigation = (url: string): void => {
    if (suppressNavigationUntilFailHandled) return;
    sendToRenderer(win, channels.PREVIEW_NAVIGATION, tabId, url);
  };

  wc.on('did-start-loading', () => {
    suppressNavigationUntilFailHandled = false;
    sendToRenderer(win, channels.PREVIEW_LOADING, tabId, true);
  });

  wc.on('did-stop-loading', () => {
    sendToRenderer(win, channels.PREVIEW_LOADING, tabId, false);
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
    sendToRenderer(win, channels.PREVIEW_PAGE_TITLE, tabId, title);
  });

  wc.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return;
      suppressNavigationUntilFailHandled = true;
      sendToRenderer(win, channels.PREVIEW_LOADING, tabId, false);
      sendToRenderer(win, channels.PREVIEW_LOAD_FAILED, tabId, {
        errorCode,
        errorDescription,
        url: validatedURL,
      });
    },
  );

  wc.setWindowOpenHandler(({ url }) => {
    if (url) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

function destroyTabGuest(win: BrowserWindow, tabId: string): void {
  const state = windowState(win);
  const entry = state.tabs.get(tabId);
  if (!entry) return;
  state.tabs.delete(tabId);
  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs.keys().next().value ?? null;
  }
  if (!win.isDestroyed()) {
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

function destroyHostForWindow(win: BrowserWindow): void {
  const state = hostsByWindowId.get(win.id);
  if (!state) return;
  for (const tabId of [...state.tabs.keys()]) {
    destroyTabGuest(win, tabId);
  }
  hostsByWindowId.delete(win.id);
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
): void {
  const rounded = roundBounds({
    x: bounds.x * zoomFactor,
    y: bounds.y * zoomFactor,
    width: bounds.width * zoomFactor,
    height: bounds.height * zoomFactor,
  });
  if (rounded.width <= 0 || rounded.height <= 0) {
    entry.view.setVisible(false);
    return;
  }
  entry.view.setBounds(rounded);
}

function hidePreviewHostEntry(entry: PreviewHostEntry): void {
  entry.visible = false;
  entry.view.setVisible(false);
  entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

function detachAllTabViews(win: BrowserWindow): void {
  const state = windowState(win);
  for (const entry of state.tabs.values()) {
    hidePreviewHostEntry(entry);
    try {
      win.contentView.removeChildView(entry.view);
    } catch {
      /* not attached */
    }
  }
}

function createTabGuest(win: BrowserWindow, tabId: string): PreviewHostEntry {
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
  wirePreviewGuestEvents(win, tabId, view.webContents);
  return { view, visible: false };
}

function getOrCreateTab(win: BrowserWindow, tabId: string): PreviewHostEntry {
  const state = windowState(win);
  const existing = state.tabs.get(tabId);
  if (existing) return existing;
  const entry = createTabGuest(win, tabId);
  state.tabs.set(tabId, entry);
  return entry;
}

function showActiveTab(win: BrowserWindow, bounds?: PreviewBounds): PreviewHostEntry | null {
  const state = windowState(win);
  const tabId = resolveTabId(win, state.activeTabId ?? undefined);
  if (!tabId) return null;
  const entry = getOrCreateTab(win, tabId);
  detachAllTabViews(win);
  if (isValidPreviewBounds(bounds)) {
    applyPreviewViewBounds(entry, bounds, hostZoomFactor(win));
  }
  try {
    win.contentView.addChildView(entry.view);
  } catch {
    /* already attached */
  }
  entry.visible = true;
  entry.view.setVisible(true);
  state.activeTabId = tabId;
  return entry;
}

function getActiveEntry(event: IpcMainInvokeEvent, tabId?: string): PreviewHostEntry | null {
  const win = windowFromInvoke(event);
  if (!win) return null;
  const resolved = resolveTabId(win, tabId);
  if (!resolved) return null;
  return getOrCreateTab(win, resolved);
}

/** Register preview IPC handlers (replaces main.ts stubs). */
export function registerPreviewHostIpc(): void {
  ipcMain.handle(channels.PREVIEW_TAB_CREATE, (event, tabId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return null;
    const id = typeof tabId === 'string' && tabId.trim() ? tabId.trim() : randomUUID();
    getOrCreateTab(win, id);
    const state = windowState(win);
    if (!state.activeTabId) state.activeTabId = id;
    return id;
  });

  ipcMain.handle(channels.PREVIEW_TAB_CLOSE, (event, tabId: string) => {
    const win = windowFromInvoke(event);
    if (!win || typeof tabId !== 'string') return;
    destroyTabGuest(win, tabId);
  });

  ipcMain.handle(channels.PREVIEW_TAB_ACTIVATE, (event, tabId: string) => {
    const win = windowFromInvoke(event);
    if (!win || typeof tabId !== 'string') return;
    const state = windowState(win);
    if (!state.tabs.has(tabId)) getOrCreateTab(win, tabId);
    state.activeTabId = tabId;
    showActiveTab(win);
  });

  ipcMain.handle(channels.PREVIEW_TAB_LIST, (event) => {
    const win = windowFromInvoke(event);
    if (!win) return [];
    const state = windowState(win);
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

  ipcMain.handle(channels.PREVIEW_SHOW, (event, bounds?: PreviewBounds, tabId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return;
    const state = windowState(win);
    if (tabId && typeof tabId === 'string') {
      state.activeTabId = tabId;
    }
    showActiveTab(win, bounds);
  });

  ipcMain.handle(channels.PREVIEW_HIDE, (event, tabId?: string) => {
    const win = windowFromInvoke(event);
    if (!win) return;
    if (tabId && typeof tabId === 'string') {
      const entry = windowState(win).tabs.get(tabId);
      if (entry) hidePreviewHostEntry(entry);
      return;
    }
    detachAllTabViews(win);
  });

  ipcMain.handle(channels.PREVIEW_CLEAR, async (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    if (!entry) return;
    try {
      await previewClearGuest(entry.view.webContents);
    } catch (err) {
      console.warn('[preview] clear failed:', err instanceof Error ? err.message : err);
    }
  });

  ipcMain.handle(
    channels.PREVIEW_LOAD_SOURCE,
    (event, payload: PreviewLoadSourcePayload, tabId?: string) => {
      const win = windowFromInvoke(event);
      const entry = getActiveEntry(event, tabId);
      if (!entry || !win || !payload || typeof payload !== 'object') return;
      if (tabId && typeof tabId === 'string') {
        windowState(win).activeTabId = tabId;
        showActiveTab(win);
      }
      void loadSourceInGuest(entry.view.webContents, payload).catch((err) => {
        if (!win) return;
        const message = err instanceof Error ? err.message : String(err);
        const id = resolveTabId(win, tabId) ?? 'unknown';
        sendToRenderer(win, channels.PREVIEW_LOAD_FAILED, id, {
          errorCode: -2,
          errorDescription: message,
          url: payload.kind === 'url' ? payload.url : payload.path,
        });
      });
    },
  );

  ipcMain.handle(channels.PREVIEW_LOAD_URL, (event, url: string, tabId?: string) => {
    const win = windowFromInvoke(event);
    const entry = getActiveEntry(event, tabId);
    if (!entry || typeof url !== 'string' || !url.trim()) return;
    if (win && tabId && typeof tabId === 'string') {
      windowState(win).activeTabId = tabId;
      showActiveTab(win);
    }
    void entry.view.webContents.loadURL(url);
  });

  ipcMain.handle(channels.PREVIEW_RELOAD, (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    if (!entry) return;
    const wc = entry.view.webContents;
    if (wc.isLoading()) wc.stop();
    wc.reload();
  });

  ipcMain.handle(channels.PREVIEW_STOP, (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    if (!entry) return;
    entry.view.webContents.stop();
  });

  ipcMain.handle(channels.PREVIEW_GO_BACK, (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    const wc = entry?.view.webContents;
    if (!wc?.canGoBack()) return;
    wc.goBack();
  });

  ipcMain.handle(channels.PREVIEW_GO_FORWARD, (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    const wc = entry?.view.webContents;
    if (!wc?.canGoForward()) return;
    wc.goForward();
  });

  ipcMain.handle(channels.PREVIEW_SET_BOUNDS, (event, bounds: PreviewBounds, tabId?: string) => {
    const win = windowFromInvoke(event);
    const entry = getActiveEntry(event, tabId);
    if (!entry || !bounds || !win) return;
    if (!entry.visible) return;
    if (!isValidPreviewBounds(bounds)) {
      const { width, height } = bounds;
      if (Number.isFinite(width) && Number.isFinite(height) && (width <= 0 || height <= 0)) {
        entry.view.setVisible(false);
      }
      return;
    }
    applyPreviewViewBounds(entry, bounds, hostZoomFactor(win));
  });

  ipcMain.handle(channels.PREVIEW_EXEC_JS, async (event, code: string, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    if (!entry || typeof code !== 'string') {
      throw new Error('Preview guest is not available');
    }
    return previewExecJs(entry.view.webContents, code);
  });

  ipcMain.handle(channels.PREVIEW_CAPTURE_PAGE, async (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    if (!entry) {
      throw new Error('Preview guest is not available');
    }
    return previewCapturePageBase64(entry.view.webContents);
  });

  ipcMain.handle(channels.PREVIEW_GET_INFO, (event, tabId?: string) => {
    const entry = getActiveEntry(event, tabId);
    if (!entry) {
      return { url: '', title: '', loading: false };
    }
    return previewGetGuestInfo(entry.view.webContents);
  });

  ipcMain.handle(channels.PREVIEW_NAVIGATE_AWAIT, async (event, url: string, tabId?: string) => {
    const win = windowFromInvoke(event);
    const entry = getActiveEntry(event, tabId);
    if (!entry) {
      return {
        ok: false,
        url: typeof url === 'string' ? url : '',
        title: '',
        errorDescription: 'Preview guest is not available',
      };
    }
    if (win && tabId && typeof tabId === 'string') {
      windowState(win).activeTabId = tabId;
      showActiveTab(win);
    }
    if (typeof url !== 'string') {
      return previewNavigateAwait(entry.view.webContents, '');
    }
    return previewNavigateAwait(entry.view.webContents, url);
  });
}

/** Tear down all preview hosts (app quit). */
export function destroyAllPreviewHosts(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    destroyHostForWindow(win);
  }
  hostsByWindowId.clear();
}
