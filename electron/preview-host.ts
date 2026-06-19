/**
 * WebContentsView preview host (MIN-112): Chromium guest for any URL or workspace file.
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
import * as channels from './ipc-channels.js';
import {
  previewCapturePageBase64,
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

const hostsByWindowId = new Map<number, PreviewHostEntry>();

function ensurePreviewSession(): void {
  configurePreviewSession(session.fromPartition(PREVIEW_SESSION_PARTITION));
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
function wirePreviewGuestEvents(win: BrowserWindow, wc: WebContents): void {
  let suppressNavigationUntilFailHandled = false;

  const emitNavigation = (url: string): void => {
    if (suppressNavigationUntilFailHandled) return;
    sendToRenderer(win, channels.PREVIEW_NAVIGATION, url);
  };

  wc.on('did-start-loading', () => {
    suppressNavigationUntilFailHandled = false;
    sendToRenderer(win, channels.PREVIEW_LOADING, true);
  });

  wc.on('did-stop-loading', () => {
    sendToRenderer(win, channels.PREVIEW_LOADING, false);
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
    sendToRenderer(win, channels.PREVIEW_PAGE_TITLE, title);
  });

  wc.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED — navigation superseded
      suppressNavigationUntilFailHandled = true;
      sendToRenderer(win, channels.PREVIEW_LOADING, false);
      sendToRenderer(win, channels.PREVIEW_LOAD_FAILED, {
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

function destroyHostForWindow(win: BrowserWindow): void {
  const entry = hostsByWindowId.get(win.id);
  if (!entry) return;
  hostsByWindowId.delete(win.id);
  if (!win.isDestroyed()) {
    try {
      win.contentView.removeChildView(entry.view);
    } catch {
      /* view may already be detached */
    }
  }
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close();
  }
}

async function loadSourceInGuest(
  wc: WebContents,
  payload: PreviewLoadSourcePayload,
): Promise<void> {
  // Workspace files are resolved by the renderer into a /api/preview/file/ URL so
  // the server's workspaceRoot is the resolver; the Electron main process never
  // knows the user's workspace path and would resolve against the wrong root.
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

/**
 * Host window page-zoom factor (Ctrl +/- on the Minnow UI). Defaults to 1.
 * The renderer reports #previewBody bounds in CSS pixels, which live in the
 * zoomed coordinate space; WebContentsView.setBounds wants DIPs. OS display
 * scaling is already handled by Electron's DIP system, so we correct only for
 * page zoom: DIP = cssPx * zoomFactor.
 */
function hostZoomFactor(win: BrowserWindow | null): number {
  if (!win || win.isDestroyed()) return 1;
  try {
    const z = win.webContents.getZoomFactor();
    return Number.isFinite(z) && z > 0 ? z : 1;
  } catch {
    return 1;
  }
}

/** Apply bounds to the guest view (main process only). */
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
function getOrCreateHost(win: BrowserWindow): PreviewHostEntry {
  const existing = hostsByWindowId.get(win.id);
  if (existing) return existing;

  ensurePreviewSession();

  const view = new WebContentsView({
    webPreferences: {
      partition: PREVIEW_SESSION_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Guest must load cross-origin subresources (CDNs, APIs) like a normal browser tab.
      webSecurity: false,
    },
  });

  view.setBackgroundColor('#ffffff');
  view.setVisible(false);
  win.contentView.addChildView(view);

  attachPermissionHandler(view.webContents);
  wirePreviewGuestEvents(win, view.webContents);

  const entry: PreviewHostEntry = { view, visible: false };
  hostsByWindowId.set(win.id, entry);

  win.once('closed', () => {
    destroyHostForWindow(win);
  });

  return entry;
}

function getHostFromInvoke(event: IpcMainInvokeEvent): PreviewHostEntry | null {
  const win = windowFromInvoke(event);
  if (!win) return null;
  return getOrCreateHost(win);
}

/** Register preview IPC handlers (replaces main.ts stubs). */
export function registerPreviewHostIpc(): void {
  ipcMain.handle(channels.PREVIEW_SHOW, (event, bounds?: PreviewBounds) => {
    const win = windowFromInvoke(event);
    const entry = getHostFromInvoke(event);
    if (!entry || !win) return;
    // Position before showing so the guest never flashes at a stale rect from the prior session.
    if (isValidPreviewBounds(bounds)) {
      applyPreviewViewBounds(entry, bounds, hostZoomFactor(win));
    }
    try {
      win.contentView.removeChildView(entry.view);
    } catch {
      /* not attached yet */
    }
    win.contentView.addChildView(entry.view);
    entry.visible = true;
    entry.view.setVisible(true);
  });

  ipcMain.handle(channels.PREVIEW_HIDE, (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) return;
    entry.visible = false;
    entry.view.setVisible(false);
    entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  });

  ipcMain.handle(channels.PREVIEW_CLEAR, async (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) return;
    const wc = entry.view.webContents;
    if (wc.isLoading()) {
      wc.stop();
    }
    await wc.loadURL('about:blank');
  });

  ipcMain.handle(channels.PREVIEW_LOAD_SOURCE, (event, payload: PreviewLoadSourcePayload) => {
    const entry = getHostFromInvoke(event);
    if (!entry || !payload || typeof payload !== 'object') return;
    void loadSourceInGuest(entry.view.webContents, payload).catch((err) => {
      const win = windowFromInvoke(event);
      if (!win) return;
      const message = err instanceof Error ? err.message : String(err);
      sendToRenderer(win, channels.PREVIEW_LOAD_FAILED, {
        errorCode: -2,
        errorDescription: message,
        url: payload.kind === 'url' ? payload.url : payload.path,
      });
    });
  });

  ipcMain.handle(channels.PREVIEW_LOAD_URL, (event, url: string) => {
    const entry = getHostFromInvoke(event);
    if (!entry || typeof url !== 'string' || !url.trim()) return;
    void entry.view.webContents.loadURL(url);
  });

  ipcMain.handle(channels.PREVIEW_RELOAD, (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) return;
    const wc = entry.view.webContents;
    if (wc.isLoading()) {
      wc.stop();
    }
    wc.reload();
  });

  ipcMain.handle(channels.PREVIEW_STOP, (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) return;
    entry.view.webContents.stop();
  });

  ipcMain.handle(channels.PREVIEW_GO_BACK, (event) => {
    const entry = getHostFromInvoke(event);
    const wc = entry?.view.webContents;
    if (!wc?.canGoBack()) return;
    wc.goBack();
  });

  ipcMain.handle(channels.PREVIEW_GO_FORWARD, (event) => {
    const entry = getHostFromInvoke(event);
    const wc = entry?.view.webContents;
    if (!wc?.canGoForward()) return;
    wc.goForward();
  });

  ipcMain.handle(channels.PREVIEW_SET_BOUNDS, (event, bounds: PreviewBounds) => {
    const win = windowFromInvoke(event);
    const entry = getHostFromInvoke(event);
    if (!entry || !bounds) return;
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

  ipcMain.handle(channels.PREVIEW_EXEC_JS, async (event, code: string) => {
    const entry = getHostFromInvoke(event);
    if (!entry || typeof code !== 'string') {
      throw new Error('Preview guest is not available');
    }
    return previewExecJs(entry.view.webContents, code);
  });

  ipcMain.handle(channels.PREVIEW_CAPTURE_PAGE, async (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) {
      throw new Error('Preview guest is not available');
    }
    return previewCapturePageBase64(entry.view.webContents);
  });

  ipcMain.handle(channels.PREVIEW_GET_INFO, (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) {
      return { url: '', title: '', loading: false };
    }
    return previewGetGuestInfo(entry.view.webContents);
  });

  ipcMain.handle(channels.PREVIEW_NAVIGATE_AWAIT, async (event, url: string) => {
    const entry = getHostFromInvoke(event);
    if (!entry) {
      return {
        ok: false,
        url: typeof url === 'string' ? url : '',
        title: '',
        errorDescription: 'Preview guest is not available',
      };
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

