/**
 * Preload script: exposes a narrow typed API on window.minnow (contextBridge).
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import * as channels from './ipc-channels.js';

/** Preview bounds in CSS pixels relative to the host window content area. */
export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewLoadFailedDetail {
  errorCode: number;
  errorDescription: string;
  url?: string;
}

export interface PreviewGuestCrashedDetail {
  reason: string;
  exitCode: number;
}

export interface PreviewLoadSourcePayload {
  kind: 'workspace' | 'url';
  path?: string;
  url?: string;
  cacheBust?: number;
}

export interface PreviewNavigateAwaitResult {
  ok: boolean;
  url: string;
  title: string;
  errorCode?: number;
  errorDescription?: string;
}

export interface PreviewGuestInfo {
  url: string;
  title: string;
  loading: boolean;
}

export interface PreviewTabInfo {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  active: boolean;
}

const preview = {
  show: (bounds?: PreviewBounds, tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_SHOW, bounds, tabId),
  hide: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_HIDE, tabId),
  clear: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_CLEAR, tabId),
  loadURL: (url: string, tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_LOAD_URL, url, tabId),
  loadSource: (payload: PreviewLoadSourcePayload, tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_LOAD_SOURCE, payload, tabId),
  reload: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_RELOAD, tabId),
  stop: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_STOP, tabId),
  goBack: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_GO_BACK, tabId),
  goForward: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_GO_FORWARD, tabId),
  setBounds: (bounds: PreviewBounds, tabId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_SET_BOUNDS, bounds, tabId),
  execJs: (code: string, tabId?: string): Promise<unknown> =>
    ipcRenderer.invoke(channels.PREVIEW_EXEC_JS, code, tabId),
  capturePage: (tabId?: string): Promise<string> =>
    ipcRenderer.invoke(channels.PREVIEW_CAPTURE_PAGE, tabId),
  getInfo: (tabId?: string): Promise<PreviewGuestInfo> =>
    ipcRenderer.invoke(channels.PREVIEW_GET_INFO, tabId),
  navigateAndWait: (url: string, tabId?: string): Promise<PreviewNavigateAwaitResult> =>
    ipcRenderer.invoke(channels.PREVIEW_NAVIGATE_AWAIT, url, tabId),
  tabs: {
    create: (tabId?: string): Promise<string> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_CREATE, tabId),
    close: (id: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_CLOSE, id),
    activate: (id: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_ACTIVATE, id),
    list: (): Promise<PreviewTabInfo[]> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_LIST),
  },
  onNavigation: (callback: (url: string, tabId?: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tabId: string, url: string) => {
      callback(url, tabId);
    };
    ipcRenderer.on(channels.PREVIEW_NAVIGATION, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_NAVIGATION, handler);
    };
  },
  onLoading: (callback: (loading: boolean, tabId?: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tabId: string, loading: boolean) => {
      callback(loading, tabId);
    };
    ipcRenderer.on(channels.PREVIEW_LOADING, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_LOADING, handler);
    };
  },
  onPageTitle: (callback: (title: string, tabId?: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tabId: string, title: string) => {
      callback(title, tabId);
    };
    ipcRenderer.on(channels.PREVIEW_PAGE_TITLE, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_PAGE_TITLE, handler);
    };
  },
  onLoadFailed: (
    callback: (detail: PreviewLoadFailedDetail, tabId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      tabId: string,
      detail: PreviewLoadFailedDetail,
    ) => {
      callback(detail, tabId);
    };
    ipcRenderer.on(channels.PREVIEW_LOAD_FAILED, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_LOAD_FAILED, handler);
    };
  },
  onGuestCrashed: (
    callback: (detail: PreviewGuestCrashedDetail, tabId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      tabId: string,
      detail: PreviewGuestCrashedDetail,
    ) => {
      callback(detail, tabId);
    };
    ipcRenderer.on(channels.PREVIEW_GUEST_CRASHED, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_GUEST_CRASHED, handler);
    };
  },
};

const minnowBridge = {
  preview,
  app: {
    platform: process.platform,
    isElectron: true as const,
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(channels.APP_OPEN_EXTERNAL, url),
  },
  diagnostics: {
    reportError: (payload: { kind: string; message: string; stack?: string }): void => {
      ipcRenderer.send(channels.DIAGNOSTICS_REPORT_ERROR, payload);
    },
    getLastCrash: (): Promise<unknown> =>
      ipcRenderer.invoke(channels.DIAGNOSTICS_LAST_CRASH),
    getOomPause: (): Promise<unknown> =>
      ipcRenderer.invoke(channels.DIAGNOSTICS_OOM_PAUSE),
    clearOomPause: (): Promise<void> =>
      ipcRenderer.invoke(channels.DIAGNOSTICS_CLEAR_OOM_PAUSE),
  },
};

contextBridge.exposeInMainWorld('minnow', minnowBridge);
