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
  // Every method below takes an optional trailing `instanceId` (MIN-364). Omitting it — as every
  // pre-MIN-364 call site does — targets the default 'workspace-preview' instance, preserving the
  // single-surface behavior that shipped before named instances existed.
  show: (bounds?: PreviewBounds, tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_SHOW, bounds, tabId, instanceId),
  hide: (tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_HIDE, tabId, instanceId),
  clear: (tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_CLEAR, tabId, instanceId),
  loadURL: (url: string, tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_LOAD_URL, url, tabId, instanceId),
  loadSource: (
    payload: PreviewLoadSourcePayload,
    tabId?: string,
    instanceId?: string,
  ): Promise<void> => ipcRenderer.invoke(channels.PREVIEW_LOAD_SOURCE, payload, tabId, instanceId),
  reload: (tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_RELOAD, tabId, instanceId),
  stop: (tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_STOP, tabId, instanceId),
  goBack: (tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_GO_BACK, tabId, instanceId),
  goForward: (tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_GO_FORWARD, tabId, instanceId),
  setBounds: (bounds: PreviewBounds, tabId?: string, instanceId?: string): Promise<void> =>
    ipcRenderer.invoke(channels.PREVIEW_SET_BOUNDS, bounds, tabId, instanceId),
  execJs: (code: string, tabId?: string, instanceId?: string): Promise<unknown> =>
    ipcRenderer.invoke(channels.PREVIEW_EXEC_JS, code, tabId, instanceId),
  capturePage: (tabId?: string, instanceId?: string): Promise<string> =>
    ipcRenderer.invoke(channels.PREVIEW_CAPTURE_PAGE, tabId, instanceId),
  getInfo: (tabId?: string, instanceId?: string): Promise<PreviewGuestInfo> =>
    ipcRenderer.invoke(channels.PREVIEW_GET_INFO, tabId, instanceId),
  navigateAndWait: (
    url: string,
    tabId?: string,
    instanceId?: string,
  ): Promise<PreviewNavigateAwaitResult> =>
    ipcRenderer.invoke(channels.PREVIEW_NAVIGATE_AWAIT, url, tabId, instanceId),
  tabs: {
    create: (tabId?: string, instanceId?: string): Promise<string> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_CREATE, tabId, instanceId),
    close: (id: string, instanceId?: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_CLOSE, id, instanceId),
    activate: (id: string, instanceId?: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_ACTIVATE, id, instanceId),
    list: (instanceId?: string): Promise<PreviewTabInfo[]> =>
      ipcRenderer.invoke(channels.PREVIEW_TAB_LIST, instanceId),
  },
  /** Named preview instance lifecycle (MIN-364) — see electron/preview-instance-registry.ts. */
  instances: {
    create: (instanceId?: string): Promise<string> =>
      ipcRenderer.invoke(channels.PREVIEW_INSTANCE_CREATE, instanceId),
    destroy: (instanceId: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_INSTANCE_DESTROY, instanceId),
    list: (): Promise<string[]> => ipcRenderer.invoke(channels.PREVIEW_INSTANCE_LIST),
  },
  onNavigation: (callback: (url: string, tabId?: string, instanceId?: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tabId: string, url: string, instanceId?: string) => {
      callback(url, tabId, instanceId);
    };
    ipcRenderer.on(channels.PREVIEW_NAVIGATION, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_NAVIGATION, handler);
    };
  },
  onLoading: (
    callback: (loading: boolean, tabId?: string, instanceId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      tabId: string,
      loading: boolean,
      instanceId?: string,
    ) => {
      callback(loading, tabId, instanceId);
    };
    ipcRenderer.on(channels.PREVIEW_LOADING, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_LOADING, handler);
    };
  },
  onPageTitle: (
    callback: (title: string, tabId?: string, instanceId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      tabId: string,
      title: string,
      instanceId?: string,
    ) => {
      callback(title, tabId, instanceId);
    };
    ipcRenderer.on(channels.PREVIEW_PAGE_TITLE, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_PAGE_TITLE, handler);
    };
  },
  onLoadFailed: (
    callback: (detail: PreviewLoadFailedDetail, tabId?: string, instanceId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      tabId: string,
      detail: PreviewLoadFailedDetail,
      instanceId?: string,
    ) => {
      callback(detail, tabId, instanceId);
    };
    ipcRenderer.on(channels.PREVIEW_LOAD_FAILED, handler);
    return () => {
      ipcRenderer.removeListener(channels.PREVIEW_LOAD_FAILED, handler);
    };
  },
  onGuestCrashed: (
    callback: (detail: PreviewGuestCrashedDetail, tabId?: string, instanceId?: string) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      tabId: string,
      detail: PreviewGuestCrashedDetail,
      instanceId?: string,
    ) => {
      callback(detail, tabId, instanceId);
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
