/**
 * In-app browser preview panel (workspace files + arbitrary URLs).
 * Electron: WebContentsView via window.minnow.preview (MIN-112).
 * Browser (npm start): same-origin iframe in #previewFrame (MIN-105).
 */

import type { MinnowPreviewApi } from '../electron';
import {
  getFilePanelState,
  patchFilePanelState,
  type PreviewSource,
} from '../state/file-panel';
import { onFileSaved } from '../state/preview-events';
import {
  hidePreviewSplit,
  showPreviewSplit,
} from './file-layout';
import { dismissFileViewerForPreview } from './file-viewer';
import { detectEmbedBlockedFrame } from './preview-embed-detect';
import { HTTP_URL_RE, parsePreviewAddress } from './preview-url';

const BROWSER_PREVIEW_HINT =
  'Full Chromium preview (any website or local file) runs in the Minnow desktop shell. Run npm start — Electron opens by default — or npm run electron:dev.';
const PREVIEW_FILE_API = '/api/preview/file/';
const FRAME_BLOCKED_TIMEOUT_MS = 1500;
const MIN_RELOAD_INTERVAL_MS = 1000;
const DEFERRED_PREVIEW_LOAD_MS = 800;

const EMBED_BLOCKED_MESSAGE =
  'This site blocks embedded previews (X-Frame-Options or CSP frame-ancestors). Sites like Google, GitHub, and most login pages cannot load inside an iframe. Preview workspace HTML files instead, or open this URL in a new tab.';

let controlsBound = false;
let boundsObserver: ResizeObserver | null = null;
let boundsRaf = 0;
let autoReloadDebounce: ReturnType<typeof setTimeout> | null = null;
let deferredPreviewLoadTimer: ReturnType<typeof setTimeout> | null = null;
let frameBlockedTimer: ReturnType<typeof setTimeout> | null = null;
let lastReloadAt = 0;
let embedBlockedActive = false;
let unsubscribeNavigation: (() => void) | null = null;
let unsubscribeLoading: (() => void) | null = null;
let unsubscribeLoadFailed: (() => void) | null = null;

function usesElectronPreview(): boolean {
  return Boolean(getPreviewApi());
}

function getPreviewApi(): MinnowPreviewApi | undefined {
  return window.minnow?.preview;
}

function getFrame(): HTMLIFrameElement | null {
  return document.getElementById('previewFrame') as HTMLIFrameElement | null;
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

/** Absolute URL passed to the preview guest (Electron or iframe with full origin). */
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
  return parsePreviewAddress(raw, { allowLocalFiles: usesElectronPreview() });
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
  hideEmbedBlockedNotice();
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
  if (!url || url === 'about:blank' || url.startsWith('chrome-error:')) return;
  hidePreviewStatus();

  if (url.startsWith('file://') || HTTP_URL_RE.test(url)) {
    patchFilePanelState({ previewSource: { kind: 'url', url } });
    return;
  }

  try {
    const parsed = new URL(url);
    const prefix = `${window.location.origin}${PREVIEW_FILE_API}`;
    if (parsed.origin === window.location.origin && parsed.pathname.startsWith(PREVIEW_FILE_API)) {
      const encoded = parsed.pathname.slice(PREVIEW_FILE_API.length);
      const path = decodeURIComponent(encoded).replace(/^\/+/, '');
      patchFilePanelState({ previewSource: { kind: 'workspace', path } });
    }
  } catch {
    /* ignore malformed URLs */
  }
}

function onPreviewLoadFailed(detail: {
  errorCode: number;
  errorDescription: string;
  url?: string;
}): void {
  setPreviewLoading(false);
  let message =
    detail.errorDescription?.trim() ||
    `Preview failed to load (error ${detail.errorCode}).`;
  if (detail.errorCode === -27 || /ERR_BLOCKED_BY_RESPONSE/i.test(message)) {
    message =
      'This site refused to load in the embedded browser. Use Open in new tab, or try again after restarting Minnow.';
  }
  const previewSource = getFilePanelState().previewSource;
  const externalUrl =
    detail.url && (detail.url.startsWith('http') || detail.url.startsWith('file:'))
      ? detail.url
      : previewSource?.kind === 'url'
        ? previewSource.url
        : undefined;
  showPreviewStatus(message, externalUrl);
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
  if (!body || boundsObserver || !usesElectronPreview()) return;
  boundsObserver = new ResizeObserver(() => {
    scheduleSyncPreviewBounds();
  });
  boundsObserver.observe(body);
  window.addEventListener('resize', scheduleSyncPreviewBounds);
  scheduleSyncPreviewBounds();
}

function markPreviewHostMode(): void {
  const body = getPreviewBody();
  if (!body) return;
  body.classList.toggle('preview-body--electron', usesElectronPreview());
}

async function showPreviewHost(): Promise<void> {
  const api = getPreviewApi();
  if (!api) return;
  await api.show();
  scheduleSyncPreviewBounds();
  requestAnimationFrame(() => {
    scheduleSyncPreviewBounds();
  });
}

async function hidePreviewHost(): Promise<void> {
  const api = getPreviewApi();
  if (!api) return;
  await api.hide();
}

async function loadSourceInPreview(source: PreviewSource, cacheBust?: number): Promise<void> {
  const api = getPreviewApi();
  if (!api) return;
  setPreviewLoading(true);
  // Workspace files go through /api/preview/file/ on the renderer's server so the
  // server's workspaceRoot (not the Electron main process's process.cwd) is the resolver.
  const url =
    source.kind === 'workspace'
      ? resolvePreviewLoadUrl(source, cacheBust)
      : source.url;
  if (api.loadSource) {
    await api.loadSource({ kind: 'url', url, cacheBust });
    return;
  }
  await api.loadURL(url);
}

function clearFrameBlockedTimer(): void {
  if (frameBlockedTimer) {
    clearTimeout(frameBlockedTimer);
    frameBlockedTimer = null;
  }
}

function readFrameEmbedSignals(frame: HTMLIFrameElement): {
  href: string;
  bodyText: string;
} {
  try {
    const href = frame.contentWindow?.location.href ?? '';
    const bodyText = frame.contentDocument?.body?.innerText ?? '';
    return { href, bodyText };
  } catch {
    return { href: '', bodyText: '' };
  }
}

function isExternalUrlBlockedInFrame(frame: HTMLIFrameElement): boolean {
  const { href, bodyText } = readFrameEmbedSignals(frame);
  return detectEmbedBlockedFrame(href, bodyText, { externalUrlMode: true });
}

function showEmbedBlockedNotice(externalUrl: string): void {
  const status = getStatusEl();
  const message = getStatusMessageEl();
  const link = getOpenExternalLink();
  const body = getPreviewBody();
  if (!status || !message) return;

  embedBlockedActive = true;
  message.textContent = EMBED_BLOCKED_MESSAGE;
  if (link) {
    link.href = externalUrl;
    link.classList.remove('hidden');
  }
  body?.classList.add('is-embed-blocked');
  status.hidden = false;
}

function hideEmbedBlockedNotice(): void {
  const status = getStatusEl();
  const link = getOpenExternalLink();
  const body = getPreviewBody();
  embedBlockedActive = false;
  if (status) status.hidden = true;
  if (link) {
    link.classList.add('hidden');
    link.removeAttribute('href');
  }
  body?.classList.remove('is-embed-blocked');
}

function checkExternalUrlEmbedAfterLoad(): void {
  const frame = getFrame();
  const source = getFilePanelState().previewSource;
  if (!frame || source?.kind !== 'url') return;

  if (isExternalUrlBlockedInFrame(frame)) {
    showEmbedBlockedNotice(source.url);
    return;
  }

  try {
    const doc = frame.contentDocument;
    if (doc && doc.body && doc.body.childElementCount === 0) {
      showEmbedBlockedNotice(source.url);
      return;
    }
  } catch {
    // Cross-origin embed allowed — cannot read document; treat as success.
  }

  hideEmbedBlockedNotice();
}

function scheduleFrameBlockedCheck(): void {
  clearFrameBlockedTimer();
  frameBlockedTimer = setTimeout(() => {
    frameBlockedTimer = null;
    checkExternalUrlEmbedAfterLoad();
  }, FRAME_BLOCKED_TIMEOUT_MS);
}

function clearPreviewFrame(): void {
  const frame = getFrame();
  if (!frame) return;
  frame.removeAttribute('src');
  frame.src = 'about:blank';
}

function applySourceToFrame(source: PreviewSource, cacheBust?: number): void {
  const frame = getFrame();
  const input = getUrlInput();
  if (!frame) return;

  embedBlockedActive = false;
  hideEmbedBlockedNotice();
  clearFrameBlockedTimer();
  hidePreviewStatus();

  if (input) input.value = sourceToAddressBar(source);

  if (source.kind === 'url') {
    frame.src = source.url;
    scheduleFrameBlockedCheck();
    return;
  }

  frame.src = workspacePreviewUrl(source.path, cacheBust);
}

function applySourceToPreview(source: PreviewSource, cacheBust?: number): void {
  if (usesElectronPreview()) {
    hidePreviewStatus();
    const input = getUrlInput();
    if (input) input.value = sourceToAddressBar(source);
    void loadSourceInPreview(source, cacheBust);
    return;
  }

  if (source.kind === 'url') {
    showPreviewStatus(BROWSER_PREVIEW_HINT, source.url);
  } else {
    hidePreviewStatus();
  }
  applySourceToFrame(source, cacheBust);
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
  if (usesElectronPreview()) {
    void showPreviewHost();
  }
  const state = getFilePanelState();
  const resolved = source ?? state.previewSource;
  if (resolved) {
    loadPreviewSource(resolved);
  } else {
    const input = getUrlInput();
    if (input) input.value = '';
    hidePreviewStatus();
    if (usesElectronPreview()) {
      void getPreviewApi()?.stop();
    } else {
      clearPreviewFrame();
    }
  }
  syncPreviewChromeFromState();
}

/** Close the preview panel. */
export function closePreviewPanel(): void {
  cancelDeferredPreviewLoad();
  if (usesElectronPreview()) {
    void hidePreviewHost();
  } else {
    clearFrameBlockedTimer();
    clearPreviewFrame();
  }
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

function goBackInFrame(): void {
  const frame = getFrame();
  try {
    frame?.contentWindow?.history.back();
  } catch {
    /* cross-origin history may be inaccessible */
  }
}

function goForwardInFrame(): void {
  const frame = getFrame();
  try {
    frame?.contentWindow?.history.forward();
  } catch {
    /* cross-origin history may be inaccessible */
  }
}

function bindPreviewControls(): void {
  if (controlsBound) return;
  controlsBound = true;

  markPreviewHostMode();

  document.getElementById('btnPreviewBack')?.addEventListener('click', () => {
    if (usesElectronPreview()) {
      void getPreviewApi()?.goBack();
    } else {
      goBackInFrame();
    }
  });
  document.getElementById('btnPreviewForward')?.addEventListener('click', () => {
    if (usesElectronPreview()) {
      void getPreviewApi()?.goForward();
    } else {
      goForwardInFrame();
    }
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

  const frame = getFrame();
  frame?.addEventListener('load', () => {
    if (usesElectronPreview()) return;
    clearFrameBlockedTimer();
    const source = getFilePanelState().previewSource;
    if (source?.kind !== 'url') {
      hideEmbedBlockedNotice();
      return;
    }
    if (embedBlockedActive) return;
    const { href } = readFrameEmbedSignals(frame);
    if (href === 'about:blank') return;
    checkExternalUrlEmbedAfterLoad();
    if (!embedBlockedActive) {
      scheduleFrameBlockedCheck();
    }
  });

  onFileSaved(onWorkspaceFileSaved);
  bindPreviewIpcListeners();
  startBoundsObserver();

  const back = getBackButton();
  const forward = getForwardButton();
  if (back) back.disabled = false;
  if (forward) forward.disabled = false;
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
    } else if (!usesElectronPreview()) {
      clearPreviewFrame();
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
  if (usesElectronPreview()) {
    void showPreviewHost();
  }
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
