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

export interface MinnowPreviewApi {
  show(bounds?: MinnowPreviewBounds): Promise<void>;
  hide(): Promise<void>;
  clear(): Promise<void>;
  loadURL(url: string): Promise<void>;
  loadSource(payload: MinnowPreviewLoadSourcePayload): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  setBounds(bounds: MinnowPreviewBounds): Promise<void>;
  execJs(code: string): Promise<unknown>;
  capturePage(): Promise<string>;
  getInfo(): Promise<MinnowPreviewGuestInfo>;
  navigateAndWait(url: string): Promise<MinnowPreviewNavigateAwaitResult>;
  onNavigation(callback: (url: string) => void): () => void;
  onLoading(callback: (loading: boolean) => void): () => void;
  onPageTitle(callback: (title: string) => void): () => void;
  onLoadFailed(callback: (detail: MinnowPreviewLoadFailedDetail) => void): () => void;
}

export interface MinnowAppApi {
  platform: NodeJS.Platform;
  isElectron: true;
  openExternal(url: string): Promise<void>;
}

export interface MinnowElectronBridge {
  preview: MinnowPreviewApi;
  app: MinnowAppApi;
}

declare global {
  interface Window {
    minnow?: MinnowElectronBridge;
  }
}

export {};
