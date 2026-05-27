/**
 * In-app browser preview panel (workspace files + arbitrary URLs).
 */

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
const FRAME_BLOCKED_TIMEOUT_MS = 4000;

let controlsBound = false;
let frameBlockedTimer: ReturnType<typeof setTimeout> | null = null;
let autoReloadDebounce: ReturnType<typeof setTimeout> | null = null;

function getFrame(): HTMLIFrameElement | null {
  return document.getElementById('previewFrame') as HTMLIFrameElement | null;
}

function getUrlInput(): HTMLInputElement | null {
  return document.getElementById('previewUrlInput') as HTMLInputElement | null;
}

function getStatusEl(): HTMLElement | null {
  return document.getElementById('previewStatus');
}

function getAutoReloadCheckbox(): HTMLInputElement | null {
  return document.getElementById('previewAutoReload') as HTMLInputElement | null;
}

function normalizeWorkspacePath(input: string): string {
  return input.replace(/^\/+/, '').trim();
}

/** Build iframe src for a workspace-relative path. */
export function workspacePreviewUrl(relativePath: string, cacheBust?: number): string {
  const normalized = normalizeWorkspacePath(relativePath);
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const base = `${PREVIEW_FILE_API}${encoded}`;
  if (cacheBust === undefined) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}v=${cacheBust}`;
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

function clearFrameBlockedTimer(): void {
  if (frameBlockedTimer) {
    clearTimeout(frameBlockedTimer);
    frameBlockedTimer = null;
  }
}

function showPreviewStatus(message: string): void {
  const el = getStatusEl();
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function hidePreviewStatus(): void {
  const el = getStatusEl();
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function scheduleFrameBlockedCheck(): void {
  clearFrameBlockedTimer();
  frameBlockedTimer = setTimeout(() => {
    frameBlockedTimer = null;
    try {
      const frame = getFrame();
      if (!frame) return;
      const doc = frame.contentDocument;
      if (!doc || !doc.body) {
        showPreviewStatus(
          'This site refused to load in the preview (X-Frame-Options or CSP frame-ancestors).',
        );
      }
    } catch {
      // Cross-origin loads throw on contentDocument — treat as successful navigation.
      hidePreviewStatus();
    }
  }, FRAME_BLOCKED_TIMEOUT_MS);
}

function applySourceToFrame(source: PreviewSource, cacheBust?: number): void {
  const frame = getFrame();
  const input = getUrlInput();
  if (!frame) return;

  hidePreviewStatus();
  clearFrameBlockedTimer();

  if (source.kind === 'url') {
    frame.src = source.url;
    if (input) input.value = source.url;
    scheduleFrameBlockedCheck();
    return;
  }

  const src = workspacePreviewUrl(source.path, cacheBust);
  frame.src = src;
  if (input) input.value = source.path;
}

/** Load the given source into the preview iframe and persist state. */
export function loadPreviewSource(source: PreviewSource, options?: { cacheBust?: boolean }): void {
  const bust = options?.cacheBust ? Date.now() : undefined;
  patchFilePanelState({ previewSource: source });
  applySourceToFrame(source, bust);
}

/** Open the preview panel with an optional initial source. */
export function openPreviewPanel(source?: PreviewSource | null): void {
  if (!dismissFileViewerForPreview()) return;
  showPreviewSplit();
  const state = getFilePanelState();
  const resolved = source ?? state.previewSource;
  if (resolved) {
    loadPreviewSource(resolved);
  } else {
    const input = getUrlInput();
    if (input) input.value = '';
    const frame = getFrame();
    if (frame) frame.removeAttribute('src');
    hidePreviewStatus();
  }
  syncPreviewChromeFromState();
}

/** Close the preview panel. */
export function closePreviewPanel(): void {
  hidePreviewSplit();
  clearFrameBlockedTimer();
  hidePreviewStatus();
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
  const state = getFilePanelState();
  if (!state.previewSource) {
    const input = getUrlInput();
    const parsed = input ? parseAddressInput(input.value) : null;
    if (parsed) {
      loadPreviewSource(parsed, { cacheBust: true });
    }
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
    reloadPreview();
  }, 250);
}

function bindPreviewControls(): void {
  if (controlsBound) return;
  controlsBound = true;

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

  const frame = getFrame();
  frame?.addEventListener('load', () => {
    clearFrameBlockedTimer();
    try {
      const doc = frame.contentDocument;
      if (doc?.body?.childElementCount === 0 && getFilePanelState().previewSource?.kind === 'url') {
        showPreviewStatus(
          'This site refused to load in the preview (X-Frame-Options or CSP frame-ancestors).',
        );
        return;
      }
      hidePreviewStatus();
    } catch {
      hidePreviewStatus();
    }
  });

  onFileSaved(onWorkspaceFileSaved);
}

/** Wire preview UI after file panel boot. */
export function initPreviewPanel(): void {
  bindPreviewControls();
  const state = getFilePanelState();
  if (state.rightPaneMode === 'preview') {
    openPreviewPanel(state.previewSource);
  }
}

/** Open a workspace HTML file in the preview panel. */
export function openWorkspacePathInPreview(relativePath: string): void {
  openPreviewPanel({ kind: 'workspace', path: normalizeWorkspacePath(relativePath) });
}
