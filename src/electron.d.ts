/**
 * Renderer typings for window.minnow exposed by electron/preload.ts.
 */

export interface MinnowPreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinnowPreviewLoadFailedDetail {
  errorCode: number;
  errorDescription: string;
  url?: string;
}

export interface MinnowPreviewGuestCrashedDetail {
  reason: string;
  exitCode: number;
}

export interface MinnowPreviewLoadSourcePayload {
  kind: 'workspace' | 'url';
  path?: string;
  url?: string;
  cacheBust?: number;
}

export interface MinnowPreviewNavigateAwaitResult {
  ok: boolean;
  url: string;
  title: string;
  errorCode?: number;
  errorDescription?: string;
}

export interface MinnowPreviewGuestInfo {
  url: string;
  title: string;
  loading: boolean;
}

export interface MinnowPreviewTabInfo {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  active: boolean;
}

export interface MinnowPreviewTabsApi {
  create(tabId?: string): Promise<string>;
  close(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  list(): Promise<MinnowPreviewTabInfo[]>;
}

export interface MinnowPreviewApi {
  show(bounds?: MinnowPreviewBounds, tabId?: string): Promise<void>;
  hide(tabId?: string): Promise<void>;
  clear(tabId?: string): Promise<void>;
  loadURL(url: string, tabId?: string): Promise<void>;
  loadSource(payload: MinnowPreviewLoadSourcePayload, tabId?: string): Promise<void>;
  reload(tabId?: string): Promise<void>;
  stop(tabId?: string): Promise<void>;
  goBack(tabId?: string): Promise<void>;
  goForward(tabId?: string): Promise<void>;
  setBounds(bounds: MinnowPreviewBounds, tabId?: string): Promise<void>;
  execJs(code: string, tabId?: string): Promise<unknown>;
  capturePage(tabId?: string): Promise<string>;
  getInfo(tabId?: string): Promise<MinnowPreviewGuestInfo>;
  navigateAndWait(url: string, tabId?: string): Promise<MinnowPreviewNavigateAwaitResult>;
  tabs: MinnowPreviewTabsApi;
  onNavigation(callback: (url: string, tabId?: string) => void): () => void;
  onLoading(callback: (loading: boolean, tabId?: string) => void): () => void;
  onPageTitle(callback: (title: string, tabId?: string) => void): () => void;
  onLoadFailed(
    callback: (detail: MinnowPreviewLoadFailedDetail, tabId?: string) => void,
  ): () => void;
  onGuestCrashed?(
    callback: (detail: MinnowPreviewGuestCrashedDetail, tabId?: string) => void,
  ): () => void;
}

export interface MinnowAppApi {
  platform: NodeJS.Platform;
  isElectron: true;
  openExternal(url: string): Promise<void>;
}

export interface MinnowLastCrashMarker {
  kind: string;
  reason?: string;
  exitCode?: number;
  message?: string;
  ts: string;
}

export interface MinnowDiagnosticsApi {
  reportError(payload: { kind: string; message: string; stack?: string }): void;
  getLastCrash(): Promise<MinnowLastCrashMarker | null>;
  getOomPause(): Promise<MinnowLastCrashMarker | null>;
  clearOomPause(): Promise<void>;
}

export interface MinnowElectronBridge {
  preview: MinnowPreviewApi;
  app: MinnowAppApi;
  diagnostics?: MinnowDiagnosticsApi;
}

declare global {
  interface Window {
    minnow?: MinnowElectronBridge;
  }
}

export {};
