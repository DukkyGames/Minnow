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
  create(tabId?: string, instanceId?: string): Promise<string>;
  close(id: string, instanceId?: string): Promise<void>;
  activate(id: string, instanceId?: string): Promise<void>;
  list(instanceId?: string): Promise<MinnowPreviewTabInfo[]>;
}

/**
 * Named preview instance lifecycle (MIN-364). Instances are parallel WebContentsView-backed
 * surfaces (workspace right pane, Design surface, future Studio live-component frames), each
 * with its own tab set. See electron/preview-instance-registry.ts for the default instance id
 * ('workspace-preview') and reserved id conventions.
 */
export interface MinnowPreviewInstancesApi {
  create(instanceId?: string): Promise<string>;
  destroy(instanceId: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * CDP-adapted pick — structurally identical to `PickedElement` in
 * `src/design/element-picker.ts` (kept as a separate type here since electron.d.ts can't import
 * from src/design without creating a renderer↔main type coupling across build boundaries).
 */
export interface MinnowCdpPickedElement {
  uid: number | null;
  cssSelector: string;
  tagName: string;
  classList: string[];
  outerHTMLPreview: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  stylesDigest: string;
  shiftKey: boolean;
  accessibleName: string;
  contrastRatio: number | null;
}

/** Native (script-free) element picking over CDP for cross-origin preview guests (MIN-370). */
export interface MinnowCdpPickerApi {
  enable(tabId?: string, instanceId?: string): Promise<{ ok: boolean; error?: string }>;
  disable(tabId?: string, instanceId?: string): Promise<void>;
  onPick(
    callback: (picked: MinnowCdpPickedElement, tabId?: string, instanceId?: string) => void,
  ): () => void;
  onError(callback: (message: string, tabId?: string, instanceId?: string) => void): () => void;
}

export interface MinnowPreviewApi {
  // Every method takes an optional trailing `instanceId`; omitting it targets the default
  // 'workspace-preview' instance, so every pre-MIN-364 call site keeps working unchanged.
  show(bounds?: MinnowPreviewBounds, tabId?: string, instanceId?: string): Promise<void>;
  hide(tabId?: string, instanceId?: string): Promise<void>;
  clear(tabId?: string, instanceId?: string): Promise<void>;
  loadURL(url: string, tabId?: string, instanceId?: string): Promise<void>;
  loadSource(
    payload: MinnowPreviewLoadSourcePayload,
    tabId?: string,
    instanceId?: string,
  ): Promise<void>;
  reload(tabId?: string, instanceId?: string): Promise<void>;
  stop(tabId?: string, instanceId?: string): Promise<void>;
  goBack(tabId?: string, instanceId?: string): Promise<void>;
  goForward(tabId?: string, instanceId?: string): Promise<void>;
  setBounds(bounds: MinnowPreviewBounds, tabId?: string, instanceId?: string): Promise<void>;
  execJs(code: string, tabId?: string, instanceId?: string): Promise<unknown>;
  capturePage(tabId?: string, instanceId?: string): Promise<string>;
  getInfo(tabId?: string, instanceId?: string): Promise<MinnowPreviewGuestInfo>;
  navigateAndWait(
    url: string,
    tabId?: string,
    instanceId?: string,
  ): Promise<MinnowPreviewNavigateAwaitResult>;
  tabs: MinnowPreviewTabsApi;
  instances: MinnowPreviewInstancesApi;
  cdpPicker: MinnowCdpPickerApi;
  onNavigation(callback: (url: string, tabId?: string, instanceId?: string) => void): () => void;
  onLoading(callback: (loading: boolean, tabId?: string, instanceId?: string) => void): () => void;
  onPageTitle(callback: (title: string, tabId?: string, instanceId?: string) => void): () => void;
  onLoadFailed(
    callback: (detail: MinnowPreviewLoadFailedDetail, tabId?: string, instanceId?: string) => void,
  ): () => void;
  onGuestCrashed?(
    callback: (
      detail: MinnowPreviewGuestCrashedDetail,
      tabId?: string,
      instanceId?: string,
    ) => void,
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
