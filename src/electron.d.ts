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
  domPath: string;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
}

/** Docked Chromium DevTools for the preview guest (MIN-177). Electron only. */
export interface MinnowPreviewDevToolsApi {
  toggle(tabId?: string, instanceId?: string): Promise<{ open: boolean }>;
  isOpen(tabId?: string, instanceId?: string): Promise<boolean>;
  setDock(dock: 'bottom' | 'side' | 'popout'): Promise<{ dock: 'bottom' | 'side' | 'popout' }>;
  getDock(): Promise<'bottom' | 'side' | 'popout'>;
  onState(
    callback: (open: boolean, tabId?: string, instanceId?: string) => void,
  ): () => void;
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

export type MinnowPreviewContextMenuRole =
  | 'goBack'
  | 'goForward'
  | 'reload'
  | 'openLinkInNewTab'
  | 'copyLink'
  | 'openExternal'
  | 'copyImage'
  | 'copyImageAddress'
  | 'saveImage'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'replaceMisspelling'
  | 'addToDictionary'
  | 'inspect'
  | 'sendToChat';

export type MinnowPreviewContextMenuItem =
  | { type: 'separator' }
  | {
      type: 'item';
      role: MinnowPreviewContextMenuRole;
      label: string;
      enabled: boolean;
      suggestion?: string;
    };

export interface MinnowPreviewContextMenuParams {
  linkURL?: string;
  srcURL?: string;
  mediaType?: string;
  isEditable?: boolean;
  selectionText?: string;
  misspelledWord?: string;
  dictionarySuggestions?: string[];
  editFlags?: {
    canCut?: boolean;
    canCopy?: boolean;
    canPaste?: boolean;
    canSelectAll?: boolean;
  };
}

export interface MinnowPreviewContextMenuOpenPayload {
  tabId: string;
  instanceId: string;
  x: number;
  y: number;
  params: MinnowPreviewContextMenuParams;
  items: MinnowPreviewContextMenuItem[];
  canGoBack: boolean;
  canGoForward: boolean;
  pageUrl: string;
}

/** Right-click context menu for the Electron preview guest. */
export interface MinnowPreviewContextMenuApi {
  /** Legacy DOM menu path — main process uses native Menu.popup instead. */
  onOpen(callback: (payload: MinnowPreviewContextMenuOpenPayload) => void): () => void;
  /** Renderer-owned actions after the user picks Send to chat / Open in new tab. */
  onSelect(
    callback: (
      payload: MinnowPreviewContextMenuOpenPayload & {
        role: MinnowPreviewContextMenuRole;
        suggestion?: string;
      },
    ) => void,
  ): () => void;
  inspect(
    tabId: string,
    x: number,
    y: number,
    instanceId?: string,
  ): Promise<{ ok: boolean; error?: string }>;
  resolveElement(
    tabId: string,
    x: number,
    y: number,
    instanceId?: string,
  ): Promise<{
    ok: boolean;
    picked?: MinnowCdpPickedElement;
    pageUrl?: string;
    error?: string;
  }>;
  action(
    tabId: string,
    role: MinnowPreviewContextMenuRole,
    payload?: {
      x?: number;
      y?: number;
      linkURL?: string;
      srcURL?: string;
      suggestion?: string;
      misspelledWord?: string;
    },
    instanceId?: string,
  ): Promise<{ ok: boolean; error?: string }>;
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
  /** Optional: packaged shells older than MIN-177 lack the devtools bridge. */
  devtools?: MinnowPreviewDevToolsApi;
  cdpPicker: MinnowCdpPickerApi;
  /** Optional: packaged shells older than the context-menu bridge lack this. */
  contextMenu?: MinnowPreviewContextMenuApi;
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

export interface MinnowWindowApi {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Restore shell and renderer focus after a blocking native dialog. */
  restoreFocus?(): Promise<void>;
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
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

export type MinnowUpdaterChannel = 'stable' | 'beta';

export type MinnowUpdaterState =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error';

/**
 * Renderer copy of electron/updater-core.ts UpdaterStatus (same cross-boundary type
 * convention as MinnowCdpPickedElement above).
 */
export interface MinnowUpdaterStatus {
  state: MinnowUpdaterState;
  supported: boolean;
  unsupportedReason: 'dev' | 'macos-signing' | null;
  installedVersion: string;
  channel: MinnowUpdaterChannel;
  pendingVersion: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  errorMessage: string | null;
}

/** Auto-update controls (MIN-384). Only present on shells built with the updater bridge. */
export interface MinnowUpdaterApi {
  getStatus(): Promise<MinnowUpdaterStatus | null>;
  checkNow(): Promise<MinnowUpdaterStatus | null>;
  restart(): Promise<boolean>;
  setChannel(channel: MinnowUpdaterChannel): Promise<MinnowUpdaterStatus | null>;
  onStatusChanged(callback: (status: MinnowUpdaterStatus) => void): () => void;
}

export interface MinnowTrayLoadedModelRow {
  id: string;
  label: string;
  source: 'lm-studio' | 'minnow-serve';
}

export interface MinnowTrayStatusSnapshot {
  runningAgentCount: number;
  loadedLocalModels: MinnowTrayLoadedModelRow[];
}

export type MinnowTrayRendererCommand = 'new_chat' | 'open_settings' | 'unload_local_models';

export interface MinnowTrayDesktopState {
  closeToTray: boolean;
  launchAtStartup: boolean;
  supported: boolean;
  unsupportedReason: 'browser' | 'linux' | null;
}

/** System tray + desktop shell controls (close-to-tray, launch-at-startup). */
export interface MinnowTrayApi {
  getDesktopState(): Promise<MinnowTrayDesktopState>;
  setCloseToTray(enabled: boolean): Promise<MinnowTrayDesktopState>;
  setLaunchAtStartup(enabled: boolean): Promise<MinnowTrayDesktopState>;
  refreshCloseToTray(): Promise<MinnowTrayDesktopState>;
  publishStatus(status: MinnowTrayStatusSnapshot): Promise<MinnowTrayStatusSnapshot>;
  onCommand(callback: (command: MinnowTrayRendererCommand) => void): () => void;
}

export interface MinnowElectronBridge {
  preview: MinnowPreviewApi;
  app: MinnowAppApi;
  window?: MinnowWindowApi;
  diagnostics?: MinnowDiagnosticsApi;
  updater?: MinnowUpdaterApi;
  tray?: MinnowTrayApi;
}

declare global {
  interface Window {
    minnow?: MinnowElectronBridge;
  }

  /** Electron frameless shell uses -webkit-app-region for draggable title bars. */
  interface CSSStyleDeclaration {
    webkitAppRegion: 'drag' | 'no-drag' | string;
  }
}

export {};
