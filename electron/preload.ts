import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import * as channels from './ipc-channels.js';
import type { CdpPickedElement } from './preview-cdp-adapt.js';
import type { PreviewContextMenuOpenPayload } from './preview-context-menu.js';
import type { PreviewContextMenuRole } from './preview-context-menu-items.js';
import type { UpdaterChannel, UpdaterStatus } from './updater-core.js';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Preview API ──────────────────────────────────────────────────────────────

const preview = {
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
  instances: {
    create: (instanceId?: string): Promise<string> =>
      ipcRenderer.invoke(channels.PREVIEW_INSTANCE_CREATE, instanceId),
    destroy: (instanceId: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_INSTANCE_DESTROY, instanceId),
    list: (): Promise<string[]> => ipcRenderer.invoke(channels.PREVIEW_INSTANCE_LIST),
  },
  devtools: {
    toggle: (tabId?: string, instanceId?: string): Promise<{ open: boolean }> =>
      ipcRenderer.invoke(channels.PREVIEW_DEVTOOLS_TOGGLE, tabId, instanceId),
    isOpen: (tabId?: string, instanceId?: string): Promise<boolean> =>
      ipcRenderer.invoke(channels.PREVIEW_DEVTOOLS_GET_STATE, tabId, instanceId),
    setDock: (dock: 'bottom' | 'side' | 'popout'): Promise<{ dock: 'bottom' | 'side' | 'popout' }> =>
      ipcRenderer.invoke(channels.PREVIEW_DEVTOOLS_SET_DOCK, dock),
    getDock: (): Promise<'bottom' | 'side' | 'popout'> =>
      ipcRenderer.invoke(channels.PREVIEW_DEVTOOLS_GET_DOCK),
    onState: (
      callback: (open: boolean, tabId?: string, instanceId?: string) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        tabId: string,
        open: boolean,
        instanceId?: string,
      ) => callback(open, tabId, instanceId);
      ipcRenderer.on(channels.PREVIEW_DEVTOOLS_STATE, handler);
      return () => {
        ipcRenderer.removeListener(channels.PREVIEW_DEVTOOLS_STATE, handler);
      };
    },
  },
  cdpPicker: {
    enable: (tabId?: string, instanceId?: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(channels.PREVIEW_CDP_PICK_ENABLE, tabId, instanceId),
    disable: (tabId?: string, instanceId?: string): Promise<void> =>
      ipcRenderer.invoke(channels.PREVIEW_CDP_PICK_DISABLE, tabId, instanceId),
    onPick: (
      callback: (picked: CdpPickedElement, tabId?: string, instanceId?: string) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        picked: CdpPickedElement,
        tabId?: string,
        instanceId?: string,
      ) => callback(picked, tabId, instanceId);
      ipcRenderer.on(channels.PREVIEW_CDP_PICK_EVENT, handler);
      return () => {
        ipcRenderer.removeListener(channels.PREVIEW_CDP_PICK_EVENT, handler);
      };
    },
    onError: (
      callback: (message: string, tabId?: string, instanceId?: string) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        message: string,
        tabId?: string,
        instanceId?: string,
      ) => callback(message, tabId, instanceId);
      ipcRenderer.on(channels.PREVIEW_CDP_PICK_ERROR, handler);
      return () => {
        ipcRenderer.removeListener(channels.PREVIEW_CDP_PICK_ERROR, handler);
      };
    },
  },
  contextMenu: {
    onOpen: (callback: (payload: PreviewContextMenuOpenPayload) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: PreviewContextMenuOpenPayload) => {
        callback(payload);
      };
      ipcRenderer.on(channels.PREVIEW_CONTEXT_MENU_OPEN, handler);
      return () => {
        ipcRenderer.removeListener(channels.PREVIEW_CONTEXT_MENU_OPEN, handler);
      };
    },
    onSelect: (
      callback: (
        payload: PreviewContextMenuOpenPayload & {
          role: PreviewContextMenuRole;
          suggestion?: string;
        },
      ) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: PreviewContextMenuOpenPayload & {
          role: PreviewContextMenuRole;
          suggestion?: string;
        },
      ) => {
        callback(payload);
      };
      ipcRenderer.on(channels.PREVIEW_CONTEXT_MENU_SELECT, handler);
      return () => {
        ipcRenderer.removeListener(channels.PREVIEW_CONTEXT_MENU_SELECT, handler);
      };
    },
    inspect: (
      tabId: string,
      x: number,
      y: number,
      instanceId?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(channels.PREVIEW_CONTEXT_INSPECT, tabId, instanceId, x, y),
    resolveElement: (
      tabId: string,
      x: number,
      y: number,
      instanceId?: string,
    ): Promise<{
      ok: boolean;
      picked?: CdpPickedElement;
      pageUrl?: string;
      error?: string;
    }> => ipcRenderer.invoke(channels.PREVIEW_CONTEXT_RESOLVE_ELEMENT, tabId, instanceId, x, y),
    action: (
      tabId: string,
      role: PreviewContextMenuRole,
      payload?: {
        x?: number;
        y?: number;
        linkURL?: string;
        srcURL?: string;
        suggestion?: string;
        misspelledWord?: string;
      },
      instanceId?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(channels.PREVIEW_CONTEXT_ACTION, tabId, instanceId, role, payload ?? {}),
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

// ── Bridge ───────────────────────────────────────────────────────────────────

const minnowBridge = {
  preview,
  shell: {
    revealInExplorer: (
      absolutePath: string,
      kind: 'file' | 'dir',
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(channels.SHELL_REVEAL_IN_EXPLORER, absolutePath, kind),
  },
  app: {
    platform: process.platform,
    isElectron: true as const,
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(channels.APP_OPEN_EXTERNAL, url),
    getHardwareAcceleration: (): Promise<boolean> =>
      ipcRenderer.invoke(channels.APP_GET_HARDWARE_ACCELERATION),
    setHardwareAcceleration: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(channels.APP_SET_HARDWARE_ACCELERATION, enabled),
    restart: (): Promise<void> => ipcRenderer.invoke(channels.APP_RESTART),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(channels.WINDOW_MINIMIZE),
    maximize: (): Promise<void> => ipcRenderer.invoke(channels.WINDOW_MAXIMIZE),
    close: (): Promise<void> => ipcRenderer.invoke(channels.WINDOW_CLOSE),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(channels.WINDOW_IS_MAXIMIZED),
    restoreFocus: (): Promise<void> => ipcRenderer.invoke(channels.WINDOW_RESTORE_FOCUS),
    onMaximizedChanged: (callback: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized);
      ipcRenderer.on(channels.WINDOW_MAXIMIZED_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(channels.WINDOW_MAXIMIZED_CHANGED, handler);
      };
    },
    onVisibilityChanged: (callback: (visible: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, visible: boolean) => callback(visible);
      ipcRenderer.on(channels.WINDOW_VISIBILITY_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(channels.WINDOW_VISIBILITY_CHANGED, handler);
      };
    },
  },
  updater: {
    getStatus: (): Promise<UpdaterStatus | null> =>
      ipcRenderer.invoke(channels.UPDATER_GET_STATUS),
    checkNow: (): Promise<UpdaterStatus | null> =>
      ipcRenderer.invoke(channels.UPDATER_CHECK_NOW),
    restart: (): Promise<boolean> => ipcRenderer.invoke(channels.UPDATER_RESTART),
    setChannel: (channel: UpdaterChannel): Promise<UpdaterStatus | null> =>
      ipcRenderer.invoke(channels.UPDATER_SET_CHANNEL, channel),
    onStatusChanged: (callback: (status: UpdaterStatus) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, next: UpdaterStatus) => callback(next);
      ipcRenderer.on(channels.UPDATER_STATUS_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(channels.UPDATER_STATUS_CHANGED, handler);
      };
    },
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
  tray: {
    publishStatus: (snapshot: {
      agentCount: number;
      localModelCount: number;
      localModelNames: string[];
    }): void => {
      ipcRenderer.send(channels.TRAY_PUBLISH_STATUS, snapshot);
    },
    notifyReady: (): void => {
      ipcRenderer.send(channels.TRAY_NOTIFY_READY);
    },
    getCloseToTray: (): Promise<boolean> =>
      ipcRenderer.invoke(channels.TRAY_GET_CLOSE_TO_TRAY),
    setCloseToTray: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(channels.TRAY_SET_CLOSE_TO_TRAY, enabled),
    getLoginItem: (): Promise<{ openAtLogin: boolean; supported: boolean }> =>
      ipcRenderer.invoke(channels.TRAY_GET_LOGIN_ITEM),
    setLoginItem: (enabled: boolean): Promise<{ openAtLogin: boolean; supported: boolean }> =>
      ipcRenderer.invoke(channels.TRAY_SET_LOGIN_ITEM, enabled),
    onCommand: (
      callback: (command: {
        type: 'new_chat' | 'open_settings' | 'unload_local_models';
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        command: { type: 'new_chat' | 'open_settings' | 'unload_local_models' },
      ) => callback(command);
      ipcRenderer.on(channels.TRAY_COMMAND, handler);
      return () => ipcRenderer.removeListener(channels.TRAY_COMMAND, handler);
    },
    onCloseToTrayChanged: (callback: (enabled: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, enabled: boolean) => callback(enabled);
      ipcRenderer.on(channels.TRAY_CLOSE_TO_TRAY_CHANGED, handler);
      return () => ipcRenderer.removeListener(channels.TRAY_CLOSE_TO_TRAY_CHANGED, handler);
    },
    getZoomPercent: (): Promise<number> => ipcRenderer.invoke(channels.SHELL_GET_ZOOM_PERCENT),
    setZoomPercent: (percent: number): Promise<number> =>
      ipcRenderer.invoke(channels.SHELL_SET_ZOOM_PERCENT, percent),
    onZoomPercentChanged: (callback: (percent: number) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, percent: number) => callback(percent);
      ipcRenderer.on(channels.SHELL_ZOOM_PERCENT_CHANGED, handler);
      return () => ipcRenderer.removeListener(channels.SHELL_ZOOM_PERCENT_CHANGED, handler);
    },
  },
  power: {
    setAfkBoardGuard: (active: boolean): void => {
      void ipcRenderer.invoke(channels.POWER_SET_AFK_GUARD, active);
    },
    onScreenUnlocked: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on(channels.POWER_SCREEN_UNLOCKED, handler);
      return () => ipcRenderer.removeListener(channels.POWER_SCREEN_UNLOCKED, handler);
    },
  },
  board: {
    onPauseForShutdown: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on(channels.BOARD_PAUSE_FOR_SHUTDOWN, handler);
      return () => ipcRenderer.removeListener(channels.BOARD_PAUSE_FOR_SHUTDOWN, handler);
    },
  },
};

contextBridge.exposeInMainWorld('minnow', minnowBridge);
