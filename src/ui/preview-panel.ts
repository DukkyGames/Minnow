/**
 * In-app browser preview panel (workspace files + arbitrary URLs).
 * Electron: WebContentsView via window.minnow.preview (MIN-112).
 * Browser dev: IPC is a no-op; chrome and persisted state still work.
 */

import type { MinnowPreviewApi } from '../electron';
import {
  getFilePanelState,
  patchFilePanelState,
  type PreviewSource,
} from '../state/file-panel';
import { onFileSaved } from '../state/preview-events';
import {
  applyFileSidebarVisuals,
  hidePreviewSplit,
  showPreviewSplit,
} from './file-layout';
import { dismissFileViewerForPreview } from './file-viewer';

const HTTP_URL_RE = /^https?:\/\//i;
const PREVIEW_FILE_API = '/api/preview/file/';
const MIN_RELOAD_INTERVAL_MS = 1000;
const DEFERRED_PREVIEW_LOAD_MS = 800;

let controlsBound = false;
let boundsObserver: ResizeObserver | null = null;
let boundsRaf = 0;
let autoReloadDebounce: ReturnType<typeof setTimeout> | null = null;
let deferredPreviewLoadTimer: ReturnType<typeof setTimeout> | null = null;
let lastReloadAt = 0;
let unsubscribeNavigation: (() => void) | null = null;
let unsubscribeLoading: (() => void) | null = null;
let unsubscribeLoadFailed: (() => void) | null = null;

function getPreviewApi(): MinnowPreviewApi | undefined {
  return window.minnow?.preview;
}

function getUrlInput(): HTMLInputElement | null {
  return document.getElementById('previewUrlInput') as HTMLInputElement | null;
}

function getStatusEl(): HTMLElement | null {
  return document.getElementById('previewStatus');
}

function getStatusMessageEl(): HTMLElement | null {
  return document.getElementById('previewStatusMessage');
}

function getOpenExternalLink(): HTMLAnchorElement | null {
  return document.getElementById('previewOpenExternal') as HTMLAnchorElement | null;
}

function getPreviewBody(): HTMLElement | null {
  return document.getElementById('previewBody');
}

function getAutoReloadCheckbox(): HTMLInputElement | null {
  return document.getElementById('previewAutoReload') as HTMLInputElement | null;
}

function getBackButton(): HTMLButtonElement | null {
  return document.getElementById('btnPreviewBack') as HTMLButtonElement | null;
}

function getForwardButton(): HTMLButtonElement | null {
  return document.getElementById('btnPreviewForward') as HTMLButtonElement | null;
}

function getLoadingIndicator(): HTMLElement | null {
  return document.getElementById('previewLoading');
}

function normalizeWorkspacePath(input: string): string {
  return input.replace(/^\/+/, '').trim();
}

/** Build preview URL for a workspace-relative path (path only; use resolvePreviewLoadUrl for absolute). */
export function workspacePreviewUrl(relativePath: string, cacheBust?: number): string {
  const normalized = normalizeWorkspacePath(relativePath);
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const base = `${PREVIEW_FILE_API}${encoded}`;
  if (cacheBust === undefined) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}v=${cacheBust}`;
}

/** Absolute URL passed to the preview guest (Electron or future browser host). */
export function resolvePreviewLoadUrl(source: PreviewSource, cacheBust?: number): string {
  if (source.kind === 'url') return source.url;
  const path = workspacePreviewUrl(source.path, cacheBust);
  return `${window.location.origin}${path}`;
}

function sourceToAddressBar(source: PreviewSource): string {
  if (source.kind === 'url') return source.url;
  return source.path;
}

function parseAddressInput(raw: string): PreviewSource | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (HTTP_URL_RE.test(trimmed)) {
    return { kind: 'url', url: trimmed };
  }
  return { kind: 'workspace', path: normalizeWorkspacePath(trimmed) };
}

function sourcesEqual(a: PreviewSource | null, b: PreviewSource | null): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'url' && b.kind === 'url') return a.url === b.url;
  if (a.kind === 'workspace' && b.kind === 'workspace') {
    return normalizeWorkspacePath(a.path) === normalizeWorkspacePath(b.path);
  }
  return false;
}

function showPreviewStatus(message: string, externalUrl?: string): void {
  const status = getStatusEl();
  const msg = getStatusMessageEl();
  const link = getOpenExternalLink();
  if (!status || !msg) return;
  msg.textContent = message;
  if (link && externalUrl) {
    link.href = externalUrl;
    link.classList.remove('hidden');
  } else {
    link?.classList.add('hidden');
    link?.removeAttribute('href');
  }
  status.hidden = false;
}

function hidePreviewStatus(): void {
  const status = getStatusEl();
  const link = getOpenExternalLink();
  if (status) status.hidden = true;
  if (link) {
    link.classList.add('hidden');
    link.removeAttribute('href');
  }
}

function setPreviewLoading(loading: boolean): void {
  const el = getLoadingIndicator();
  if (!el) return;
  el.classList.toggle('hidden', !loading);
  el.classList.toggle('is-active', loading);
}

function syncAddressBarFromNavigation(url: string): void {
  const input = getUrlInput();
  if (!input) return;
  if (!url || url === 'about:blank') return;

  const state = getFilePanelState();
  if (state.previewSource?.kind === 'workspace') {
    try {
      const parsed = new URL(url);
      const prefix = `${window.location.origin}${PREVIEW_FILE_API}`;
      if (parsed.origin === window.location.origin && parsed.pathname.startsWith(PREVIEW_FILE_API)) {
        const encoded = parsed.pathname.slice(PREVIEW_FILE_API.length);
        const path = decodeURIComponent(encoded).replace(/^\/+/, '');
        input.value = path;
        return;
      }
    } catch {
      /* keep generic URL below */
    }
  }

  input.value = url;
}

function onPreviewNavigation(url: string): void {
  syncAddressBarFromNavigation(url);
  if (url && url !== 'about:blank') {
    hidePreviewStatus();
  }
}

function onPreviewLoadFailed(detail: {
  errorCode: number;
  errorDescription: string;
  url?: string;
}): void {
  setPreviewLoading(false);
  const message =
    detail.errorDescription?.trim() ||
    `Preview failed to load (error ${detail.errorCode}).`;
  showPreviewStatus(message, detail.url);
}

function scheduleSyncPreviewBounds(): void {
  if (boundsRaf) return;
  boundsRaf = requestAnimationFrame(() => {
    boundsRaf = 0;
    void syncPreviewBounds();
  });
}

async function syncPreviewBounds(): Promise<void> {
  const api = getPreviewApi();
  const body = getPreviewBody();
  if (!api || !body) return;
  const rect = body.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  await api.setBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

function startBoundsObserver(): void {
  const body = getPreviewBody();
  if (!body || boundsObserver) return;
  boundsObserver = new ResizeObserver(() => {
    scheduleSyncPreviewBounds();
  });
  boundsObserver.observe(body);
  window.addEventListener('resize', scheduleSyncPreviewBounds);
  scheduleSyncPreviewBounds();
}

async function showPreviewHost(): Promise<void> {
  const api = getPreviewApi();
  if (!api) return;
  await api.show();
  scheduleSyncPreviewBounds();
}

async function hidePreviewHost(): Promise<void> {
  const api = getPreviewApi();
  if (!api) return;
  await api.hide();
}

async function loadUrlInPreview(url: string): Promise<void> {
  const api = getPreviewApi();
  if (!api) return;
  setPreviewLoading(true);
  await api.loadURL(url);
}

function applySourceToPreview(source: PreviewSource, cacheBust?: number): void {
  const input = getUrlInput();
  const url = resolvePreviewLoadUrl(source, cacheBust);

  hidePreviewStatus();
  if (input) input.value = sourceToAddressBar(source);

  const api = getPreviewApi();
  if (api) {
    void loadUrlInPreview(url);
    return;
  }

  setPreviewLoading(false);
  showPreviewStatus(
    'Embedded preview runs in the Minnow desktop app (npm run electron:dev). Workspace paths and URLs are still saved.',
    source.kind === 'url' ? source.url : url,
  );
}

/** Load the given source into the preview host and persist state. */
export function loadPreviewSource(source: PreviewSource, options?: { cacheBust?: boolean }): void {
  const state = getFilePanelState();
  const bust = options?.cacheBust ? Date.now() : undefined;
  if (!sourcesEqual(state.previewSource, source)) {
    patchFilePanelState({ previewSource: source });
  }
  applySourceToPreview(source, bust);
}

/** Open the preview panel with an optional initial source. */
export function openPreviewPanel(source?: PreviewSource | null): void {
  if (!dismissFileViewerForPreview()) return;
  showPreviewSplit();
  void showPreviewHost();
  const state = getFilePanelState();
  const resolved = source ?? state.previewSource;
  if (resolved) {
    loadPreviewSource(resolved);
  } else {
    const input = getUrlInput();
    if (input) input.value = '';
    hidePreviewStatus();
    void getPreviewApi()?.stop();
  }
  syncPreviewChromeFromState();
}

/** Close the preview panel. */
export function closePreviewPanel(): void {
  cancelDeferredPreviewLoad();
  void hidePreviewHost();
  hidePreviewSplit();
  hidePreviewStatus();
  setPreviewLoading(false);
}

/** Toggle preview panel using last source or empty address bar. */
export function togglePreviewPanel(): void {
  const state = getFilePanelState();
  if (state.rightPaneMode === 'preview') {
    closePreviewPanel();
    return;
  }
  openPreviewPanel(state.previewSource);
}

function reloadPreview(): void {
  const now = Date.now();
  if (now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) return;
  lastReloadAt = now;

  const api = getPreviewApi();
  const state = getFilePanelState();
  if (!state.previewSource) {
    const input = getUrlInput();
    const parsed = input ? parseAddressInput(input.value) : null;
    if (parsed) {
      loadPreviewSource(parsed, { cacheBust: true });
    }
    return;
  }

  if (api && state.previewSource.kind === 'workspace') {
    loadPreviewSource(state.previewSource, { cacheBust: true });
    return;
  }

  if (api) {
    setPreviewLoading(true);
    void api.reload();
    return;
  }

  loadPreviewSource(state.previewSource, { cacheBust: true });
}

function navigateFromAddressBar(): void {
  const input = getUrlInput();
  if (!input) return;
  const parsed = parseAddressInput(input.value);
  if (!parsed) {
    showPreviewStatus('Enter a workspace path or https:// URL.');
    return;
  }
  loadPreviewSource(parsed);
}

function syncPreviewChromeFromState(): void {
  const state = getFilePanelState();
  const checkbox = getAutoReloadCheckbox();
  if (checkbox) checkbox.checked = state.previewAutoReload;
  if (state.previewSource) {
    const input = getUrlInput();
    if (input) input.value = sourceToAddressBar(state.previewSource);
  }
}

function pathsMatchForReload(savedPath: string, previewPath: string): boolean {
  const a = normalizeWorkspacePath(savedPath);
  const b = normalizeWorkspacePath(previewPath);
  return a === b;
}

function onWorkspaceFileSaved(path: string): void {
  const state = getFilePanelState();
  if (!state.previewAutoReload || state.rightPaneMode !== 'preview') return;
  if (!state.previewSource || state.previewSource.kind !== 'workspace') return;
  if (!pathsMatchForReload(path, state.previewSource.path)) return;

  if (autoReloadDebounce) clearTimeout(autoReloadDebounce);
  autoReloadDebounce = setTimeout(() => {
    autoReloadDebounce = null;
    const api = getPreviewApi();
    if (api) {
      setPreviewLoading(true);
      void api.reload();
      return;
    }
    reloadPreview();
  }, 250);
}

function bindPreviewIpcListeners(): void {
  const api = getPreviewApi();
  if (!api) return;

  unsubscribeNavigation?.();
  unsubscribeLoading?.();
  unsubscribeLoadFailed?.();

  unsubscribeNavigation = api.onNavigation(onPreviewNavigation);
  unsubscribeLoading = api.onLoading(setPreviewLoading);
  unsubscribeLoadFailed = api.onLoadFailed(onPreviewLoadFailed);
}

function bindPreviewControls(): void {
  if (controlsBound) return;
  controlsBound = true;

  document.getElementById('btnPreviewBack')?.addEventListener('click', () => {
    void getPreviewApi()?.goBack();
  });
  document.getElementById('btnPreviewForward')?.addEventListener('click', () => {
    void getPreviewApi()?.goForward();
  });
  document.getElementById('btnPreviewReload')?.addEventListener('click', () => reloadPreview());
  document.getElementById('btnPreviewGo')?.addEventListener('click', () => navigateFromAddressBar());
  document.getElementById('btnPreviewClose')?.addEventListener('click', () => closePreviewPanel());

  getUrlInput()?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateFromAddressBar();
    }
  });

  getAutoReloadCheckbox()?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    patchFilePanelState({ previewAutoReload: checked });
  });

  getOpenExternalLink()?.addEventListener('click', (e) => {
    const href = getOpenExternalLink()?.href;
    if (!href) return;
    if (window.minnow?.app.openExternal) {
      e.preventDefault();
      void window.minnow.app.openExternal(href);
    }
  });

  onFileSaved(onWorkspaceFileSaved);
  bindPreviewIpcListeners();
  startBoundsObserver();

  if (getPreviewApi()) {
    const back = getBackButton();
    const forward = getForwardButton();
    if (back) back.disabled = false;
    if (forward) forward.disabled = false;
  }
}

function cancelDeferredPreviewLoad(): void {
  if (deferredPreviewLoadTimer) {
    clearTimeout(deferredPreviewLoadTimer);
    deferredPreviewLoadTimer = null;
  }
}

/** Wait until the shell has finished loading before hitting preview routes (avoids socket storms in cloud). */
function scheduleDeferredPreviewLoad(source: PreviewSource | null): void {
  cancelDeferredPreviewLoad();
  const run = (): void => {
    deferredPreviewLoadTimer = null;
    if (getFilePanelState().rightPaneMode !== 'preview') return;
    if (source) {
      loadPreviewSource(source);
    }
  };

  const defer = (): void => {
    deferredPreviewLoadTimer = setTimeout(run, DEFERRED_PREVIEW_LOAD_MS);
  };

  if (document.readyState === 'complete') {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(defer, { timeout: 4000 });
    } else {
      defer();
    }
    return;
  }

  window.addEventListener('load', defer, { once: true });
}

/** Restore preview chrome without loading the guest until the app shell is idle. */
function restorePreviewPanelFromPrefs(source: PreviewSource | null): void {
  if (!dismissFileViewerForPreview()) return;
  showPreviewSplit();
  void showPreviewHost();
  syncPreviewChromeFromState();
  const input = getUrlInput();
  if (source && input) {
    input.value = sourceToAddressBar(source);
  }
  scheduleDeferredPreviewLoad(source);
}

/** Wire preview UI after file panel boot. */
export function initPreviewPanel(): void {
  bindPreviewControls();
  const state = getFilePanelState();
  if (state.rightPaneMode === 'preview') {
    restorePreviewPanelFromPrefs(state.previewSource);
  }
}

/** Open a workspace HTML file in the preview panel. */
export function openWorkspacePathInPreview(relativePath: string): void {
  openPreviewPanel({ kind: 'workspace', path: normalizeWorkspacePath(relativePath) });
}
