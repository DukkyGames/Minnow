/**
 * WebContentsView preview host (MIN-112): one embedded browser per BrowserWindow.
 */

import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import * as channels from './ipc-channels.js';

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewHostEntry {
  view: WebContentsView;
  visible: boolean;
}

const hostsByWindowId = new Map<number, PreviewHostEntry>();

const PREVIEW_PARTITION = 'persist:minnow-preview';

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
  const emitNavigation = (url: string): void => {
    sendToRenderer(win, channels.PREVIEW_NAVIGATION, url);
  };

  wc.on('did-start-loading', () => {
    sendToRenderer(win, channels.PREVIEW_LOADING, true);
  });

  wc.on('did-stop-loading', () => {
    sendToRenderer(win, channels.PREVIEW_LOADING, false);
    emitNavigation(wc.getURL());
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

/** Create (or return) the preview WebContentsView for a window. */
function getOrCreateHost(win: BrowserWindow): PreviewHostEntry {
  const existing = hostsByWindowId.get(win.id);
  if (existing) return existing;

  const view = new WebContentsView({
    webPreferences: {
      partition: PREVIEW_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
  ipcMain.handle(channels.PREVIEW_SHOW, (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) return;
    entry.visible = true;
    entry.view.setVisible(true);
  });

  ipcMain.handle(channels.PREVIEW_HIDE, (event) => {
    const entry = getHostFromInvoke(event);
    if (!entry) return;
    entry.visible = false;
    entry.view.setVisible(false);
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
    const entry = getHostFromInvoke(event);
    if (!entry || !bounds) return;
    const { x, y, width, height } = bounds;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return;
    }
    entry.view.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
    });
  });
}

/** Tear down all preview hosts (app quit). */
export function destroyAllPreviewHosts(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    destroyHostForWindow(win);
  }
  hostsByWindowId.clear();
}
