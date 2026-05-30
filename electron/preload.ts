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

const preview = {
  show: (): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_SHOW),
  hide: (): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_HIDE),
  loadURL: (url: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_LOAD_URL, url),
  loadSource: (payload: PreviewLoadSourcePayload): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_LOAD_SOURCE, payload),
  reload: (): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_RELOAD),
  stop: (): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_STOP),
  goBack: (): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_GO_BACK),
  goForward: (): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_GO_FORWARD),
  setBounds: (bounds: PreviewBounds): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_SET_BOUNDS, bounds),
  execJs: (code: string): Promise<unknown> =>
    ipcRenderer.invoke(channels.PREVIEW_EXEC_JS, code),
  capturePage: (): Promise<string> =>
    ipcRenderer.invoke(channels.PREVIEW_CAPTURE_PAGE),
  getInfo: (): Promise<PreviewGuestInfo> =>
    ipcRenderer.invoke(channels.PREVIEW_GET_INFO),
  navigateAndWait: (url: string): Promise<PreviewNavigateAwaitResult> =>
    ipcRenderer.invoke(channels.PREVIEW_NAVIGATE_AWAIT, url),
  onNavigation: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on(channels.PREVIEW_NAVIGATION, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_NAVIGATION, handler);
    };
  },
  onLoading: (callback: (loading: boolean) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, loading: boolean) => {
      callback(loading);
    };
    ipcRenderer.on(channels.PREVIEW_LOADING, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_LOADING, handler);
    };
  },
  onPageTitle: (callback: (title: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, title: string) => {
      callback(title);
    };
    ipcRenderer.on(channels.PREVIEW_PAGE_TITLE, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_PAGE_TITLE, handler);
    };
  },
  onLoadFailed: (callback: (detail: PreviewLoadFailedDetail) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, detail: PreviewLoadFailedDetail) => {
      callback(detail);
    };
    ipcRenderer.on(channels.PREVIEW_LOAD_FAILED, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_LOAD_FAILED, handler);
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
};

contextBridge.exposeInMainWorld('minnow', minnowBridge);
