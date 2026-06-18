/**
 * Editable file viewer (CodeMirror 6) with multi-tab strip and per-tab in-memory state.
 */

import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { isImageFilePath } from '../attachments/image-path';
import { setAssistantBubbleContent } from '../markdown/renderer';
import { executeTool, getLocalServerAvailable } from '../tools/client';
import { resolvePreviewLoadUrl } from './preview-panel';
import { fetchLspConfig } from '../lsp/config-client';
import { notifyLspDocument } from '../lsp/completion-client';
import {
  MAX_OPEN_VIEWER_TABS,
  patchFilePanelState,
} from '../state/file-panel';
import {
  hideViewerPaneDom,
  hideViewerSplit,
  showViewerSplit,
} from './file-layout';
import { isMarkdownFilePath } from './file-markdown-path';
import { showFilePanelContextMenu } from './file-tree-context-menu';
import {
  refreshFileTreeViaBridge,
  renderFileTreeViaBridge,
} from './file-tree-refresh-bridge';
import {
  EDITOR_AI_CONFIG_CHANGED_EVENT,
  loadEditorAiCompletionConfig,
  getEditorAiCompletionConfigSync,
} from '../config/editor-ai-completion';
import { loadEditorIntentModeConfig } from '../config/editor-intent-mode';
import { EDITOR_AI_NO_MODEL_MESSAGE } from './editor-ai-completion-client';
import { loadEditorSettings } from '../config/editor-settings';
import { minnowEditorExtensions } from './codemirror-theme';
import { editorCoreExtensions } from './editor-core-extensions';
import { loadLanguageExtensionsForPath } from './editor-language';
import { fileEditorKeymapExtensions } from './file-editor-keymap';
import { lspEditorExtensions } from './file-editor-extensions';
import { setLspDiagnosticsChromeListener } from './lsp-editor';
import { editorAiCompletionExtensions } from './file-editor-ai-extensions';
import {
  editorIntentModeExtensions,
  mountIntentModeEditor,
  isIntentModeEnabled,
  toggleIntentMode,
} from './editor-intent-mode';
import { addCodeReferenceToComposer } from '../attachments/code-ref';
import {
  buildFileViewerContextMenuItems,
  editorQuickEditExtensions,
  lineNumbersForRange,
  openQuickEditPanel,
} from './editor-quick-edit';
import {
  activateViewerTab,
  clearAllViewerTabs,
  getActiveViewerTab,
  getActiveViewerTabPath,
  getOpenViewerTabPaths,
  getViewerTab,
  isAnyViewerTabDirty,
  isViewerTabDirty,
  listViewerTabs,
  markActiveTabSaved,
  openViewerTab,
  removeViewerTab,
  restoreWorkspaceViewerTabs,
  retargetViewerTab,
  setActiveTabLoadState,
  snapshotViewerTabEditorContent,
  type OpenViewerTabOptions,
  type ViewerTabState,
} from './file-viewer-tab-store';
import { refreshFileViewerTabs, registerFileViewerTabHandlers } from './file-viewer-tabs';
import { setStatus } from './status';

export const LARGE_FILE_BYTES = 512_000;
const RANGE_LINE_COUNT = 2000;
const LSP_CHANGE_DEBOUNCE_MS = 400;

/** Footer appended when only a range of a large file is loaded. */
export const LARGE_FILE_EXCERPT_FOOTER_RE =
  /\n\n\/\* Showing lines 1–\d+ only \(\d+ bytes total\)\. \*\/\s*$/;

let editorView: EditorView | null = null;
/** Path key for the tab currently bound to `editorView` (may differ from active tab during switches). */
let editorViewPath: string | null = null;
/** Monotonic token so stale async `mountEditor` completions are discarded. */
let mountGeneration = 0;
let markdownPreviewEl: HTMLElement | null = null;
let isSaving = false;
let viewerControlsBound = false;
let viewerContextMenuBound = false;
let lspSyncedPath: string | null = null;
let lspChangeTimer: ReturnType<typeof setTimeout> | null = null;
let editorAiStatusEl: HTMLElement | null = null;
let editorIntentStatusEl: HTMLElement | null = null;
let editorIntentToggleEl: HTMLButtonElement | null = null;
/** Per-document Intent mode enabled flag (session only). */
const intentModeEnabledByPath = new Map<string, boolean>();
let editorAiModelSelectListener: (() => void) | null = null;
let diagnosticsBadgeEl: HTMLElement | null = null;

/** Strip "N: " prefixes from read_file_range output. */
export function parseReadFileRangeBody(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\d+:\s?/, ''))
    .join('\n');
}

/** Path label with optional dirty marker (●). */
export function formatViewerPathLabel(path: string, dirty: boolean): string {
  return dirty ? `${path} ●` : path;
}

/** Whether content ends with the large-file excerpt notice. */
export function hasLargeFileExcerptFooter(content: string): boolean {
  return LARGE_FILE_EXCERPT_FOOTER_RE.test(content);
}

export { isMarkdownFilePath } from './file-markdown-path';

/** Whether to show GFM preview instead of the CodeMirror editor for this open request. */
export function shouldUseMarkdownPreview(path: string, asCode?: boolean): boolean {
  return isMarkdownFilePath(path) && !asCode;
}

/** True when the viewer is showing markdown preview (not the code editor). */
export function isMarkdownPreviewActive(): boolean {
  const tab = getActiveViewerTab();
  return tab?.viewMode === 'markdown-preview' && markdownPreviewEl !== null;
}

function buildLargeFileExcerptFooter(byteLength: number): string {
  return `\n\n/* Showing lines 1–${RANGE_LINE_COUNT} only (${byteLength} bytes total). */`;
}

function getViewerHost(): HTMLElement | null {
  return document.getElementById('fileViewerHost');
}

function getIntentToggleButton(): HTMLButtonElement | null {
  return document.getElementById('btnFileViewerIntent') as HTMLButtonElement | null;
}

function getIntentStatusElement(): HTMLElement | null {
  return document.getElementById('fileViewerIntentStatus');
}

function isIntentModeEnabledForPath(path: string, defaultEnabled: boolean): boolean {
  if (intentModeEnabledByPath.has(path)) {
    return intentModeEnabledByPath.get(path) === true;
  }
  return defaultEnabled;
}

function setIntentModeEnabledForPath(path: string, enabled: boolean): void {
  intentModeEnabledByPath.set(path, enabled);
  updateIntentToolbarChrome(enabled, 0);
}

function updateIntentToolbarChrome(enabled: boolean, staleCount: number): void {
  const toggle = editorIntentToggleEl ?? getIntentToggleButton();
  const status = editorIntentStatusEl ?? getIntentStatusElement();
  if (toggle) {
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }
  if (!status) return;
  if (!enabled) {
    status.hidden = true;
    status.textContent = '';
    status.className = 'file-viewer-intent-status';
    return;
  }
  status.hidden = false;
  if (staleCount > 0) {
    status.textContent = `${staleCount} stale`;
    status.className = 'file-viewer-intent-status file-viewer-intent-status--stale';
  } else {
    status.textContent = 'in sync';
    status.className = 'file-viewer-intent-status file-viewer-intent-status--ok';
  }
}

function syncIntentToolbarAvailability(tab: ViewerTabState | null): void {
  const toggle = editorIntentToggleEl ?? getIntentToggleButton();
  if (!toggle) return;
  const available =
    Boolean(tab) &&
    tab!.viewMode === 'editor' &&
    !tab!.readOnlyExcerpt &&
    getLocalServerAvailable() &&
    Boolean(editorView);
  toggle.disabled = !available;
}

function getSaveButton(): HTMLButtonElement | null {
  return document.getElementById('btnFileViewerSave') as HTMLButtonElement | null;
}

function getReadOnlyBanner(): HTMLElement | null {
  return document.getElementById('fileViewerReadOnlyBanner');
}

function activeTabContent(tab: ViewerTabState): string {
  if (editorView && getActiveViewerTabPath() === tab.path) {
    return editorView.state.doc.toString();
  }
  return tab.cachedEditorContent ?? tab.originalContent;
}

function readOnlyBannerMessage(tab: ViewerTabState): string {
  if (tab.readOnlyBannerText) return tab.readOnlyBannerText;
  return `Read-only preview: file is larger than ${LARGE_FILE_BYTES.toLocaleString()} bytes; showing lines 1–${RANGE_LINE_COUNT} only.`;
}

function clearLspChangeTimer(): void {
  if (lspChangeTimer) {
    clearTimeout(lspChangeTimer);
    lspChangeTimer = null;
  }
}

function closeLspDocument(): void {
  clearLspChangeTimer();
  if (lspSyncedPath) {
    void notifyLspDocument(lspSyncedPath, 'close');
    lspSyncedPath = null;
  }
}

function scheduleLspChangeNotify(path: string, text: string): void {
  if (lspSyncedPath !== path) return;
  clearLspChangeTimer();
  lspChangeTimer = setTimeout(() => {
    void notifyLspDocument(path, 'change', text);
  }, LSP_CHANGE_DEBOUNCE_MS);
}

async function isLspEnabledForViewer(): Promise<boolean> {
  if (!getLocalServerAvailable()) return false;
  const cfg = await fetchLspConfig();
  return cfg?.enabled === true;
}

/** Persist the live editor buffer into the tab that owns `editorView`. */
function snapshotOutgoingEditorTab(): void {
  if (!editorView || !editorViewPath) return;
  const tab = getViewerTab(editorViewPath);
  if (!tab || tab.viewMode === 'image') return;
  const text = editorView.state.doc.toString();
  const dirty = !tab.readOnlyExcerpt && text !== tab.originalContent;
  snapshotViewerTabEditorContent(editorViewPath, text, dirty);
}

function detachEditorAiModelSelectListener(): void {
  if (!editorAiModelSelectListener) return;
  document
    .getElementById('modelSelect')
    ?.removeEventListener('change', editorAiModelSelectListener);
  editorAiModelSelectListener = null;
}

/** Clear stale "no model" hint when the user picks a model while editing. */
function attachEditorAiModelSelectListener(): void {
  detachEditorAiModelSelectListener();
  editorAiModelSelectListener = () => {
    if (!editorAiStatusEl || editorAiStatusEl.hidden) return;
    if (editorAiStatusEl.textContent === EDITOR_AI_NO_MODEL_MESSAGE) {
      editorAiStatusEl.hidden = true;
    }
  };
  document
    .getElementById('modelSelect')
    ?.addEventListener('change', editorAiModelSelectListener);
}

function destroyEditor(): void {
  snapshotOutgoingEditorTab();
  closeLspDocument();
  detachEditorAiModelSelectListener();
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
  editorViewPath = null;
  markdownPreviewEl = null;
}

function ensureDiagnosticsBadge(): HTMLElement | null {
  if (!diagnosticsBadgeEl) {
    diagnosticsBadgeEl = document.getElementById('fileViewerDiagnostics');
  }
  return diagnosticsBadgeEl;
}

function updateDiagnosticsChrome(counts: {
  errors: number;
  warnings: number;
}): void {
  const badge = ensureDiagnosticsBadge();
  if (!badge) return;
  const { errors, warnings } = counts;
  if (errors === 0 && warnings === 0) {
    badge.hidden = true;
    badge.textContent = '';
    return;
  }
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  badge.textContent = parts.join(', ');
  badge.hidden = false;
  badge.classList.toggle('file-viewer-diagnostics--errors', errors > 0);
}

function updateViewerChrome(): void {
  const tab = getActiveViewerTab();
  const saveBtn = getSaveButton();
  if (saveBtn) {
    const canSave = Boolean(
      tab &&
        editorView &&
        tab.isDirty &&
        !tab.readOnlyExcerpt &&
        tab.viewMode === 'editor' &&
        !isSaving,
    );
    saveBtn.disabled = !canSave;
    saveBtn.classList.toggle('file-viewer-save--active', canSave);
    saveBtn.setAttribute('aria-busy', isSaving ? 'true' : 'false');
  }

  const banner = getReadOnlyBanner();
  if (banner && tab) {
    banner.hidden = !tab.readOnlyExcerpt;
    if (tab.readOnlyExcerpt) {
      banner.textContent = readOnlyBannerMessage(tab);
    }
  }
  refreshFileViewerTabs();
  syncIntentToolbarAvailability(tab);
}

function mountMarkdownPreview(tab: ViewerTabState, content: string): void {
  const host = getViewerHost();
  if (!host) return;
  destroyEditor();
  host.innerHTML = '';

  if (tab.readOnlyExcerpt) {
    const banner = document.createElement('p');
    banner.id = 'fileViewerReadOnlyBanner';
    banner.className = 'file-viewer-readonly-banner';
    banner.textContent = readOnlyBannerMessage(tab);
    host.appendChild(banner);
  }

  const preview = document.createElement('div');
  preview.className = 'file-viewer-markdown-preview msg-bubble msg-bubble--md';
  host.appendChild(preview);
  markdownPreviewEl = preview;
  setAssistantBubbleContent(preview, content, { streaming: false });
  updateViewerChrome();
}

function mountEditor(tab: ViewerTabState, content: string): void {
  const host = getViewerHost();
  if (!host) return;
  const generation = ++mountGeneration;
  destroyEditor();
  host.innerHTML = '';

  if (tab.readOnlyExcerpt) {
    const banner = document.createElement('p');
    banner.id = 'fileViewerReadOnlyBanner';
    banner.className = 'file-viewer-readonly-banner';
    banner.textContent = readOnlyBannerMessage(tab);
    host.appendChild(banner);
  }

  const editorMount = document.createElement('div');
  editorMount.className = 'file-viewer-editor-mount';
  host.appendChild(editorMount);

  const aiStatus = document.createElement('p');
  aiStatus.className = 'file-viewer-ai-status field-hint';
  aiStatus.hidden = true;
  host.appendChild(aiStatus);
  editorAiStatusEl = aiStatus;

  const path = tab.path;

  void (async () => {
    const [langExts, useLsp, editorAiConfig, editorSettings, intentConfig] = await Promise.all([
      loadLanguageExtensionsForPath(path),
      isLspEnabledForViewer(),
      loadEditorAiCompletionConfig(),
      loadEditorSettings(),
      loadEditorIntentModeConfig(),
    ]);
    const readOnlyExts: Extension[] = tab.readOnlyExcerpt
      ? [EditorView.editable.of(false), EditorState.readOnly.of(true)]
      : [];
    const lspExts = useLsp ? lspEditorExtensions(path) : [];
    const useEditorAi =
      editorAiConfig.enabled && !tab.readOnlyExcerpt && getLocalServerAvailable();
    const aiExts = useEditorAi
      ? editorAiCompletionExtensions({
          filePath: path,
          getConfig: getEditorAiCompletionConfigSync,
          canRequest: () => getLocalServerAvailable(),
          onStatus: (message) => {
            if (!editorAiStatusEl) return;
            if (message) {
              editorAiStatusEl.textContent = message;
              editorAiStatusEl.hidden = false;
            } else {
              editorAiStatusEl.hidden = true;
            }
          },
        })
      : [];
    if (useEditorAi) attachEditorAiModelSelectListener();
    const quickEditExts =
      !tab.readOnlyExcerpt && getLocalServerAvailable()
        ? editorQuickEditExtensions({
            filePath: path,
            canRequest: () => getLocalServerAvailable(),
          })
        : [];
    const intentInitialEnabled = isIntentModeEnabledForPath(path, intentConfig.enabledByDefault);
    const intentExts =
      !tab.readOnlyExcerpt && getLocalServerAvailable()
        ? editorIntentModeExtensions({
            filePath: path,
            config: intentConfig,
            canRequest: () => getLocalServerAvailable(),
            initialEnabled: intentInitialEnabled,
            onEnabledChange: (enabled) => {
              setIntentModeEnabledForPath(path, enabled);
            },
            onStaleCount: (count) => {
              if (!editorView) return;
              updateIntentToolbarChrome(isIntentModeEnabled(editorView.state), count);
            },
            onStatus: (message) => {
              if (!editorAiStatusEl) return;
              if (message) {
                editorAiStatusEl.textContent = message;
                editorAiStatusEl.hidden = false;
              } else if (!editorAiConfig.enabled) {
                editorAiStatusEl.hidden = true;
              }
            },
          })
        : [];

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        ...readOnlyExts,
        ...lspExts,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          if (useLsp) {
            scheduleLspChangeNotify(path, text);
          }
          const liveTab = getViewerTab(path);
          if (!liveTab || liveTab.readOnlyExcerpt) return;
          const nextDirty = text !== liveTab.originalContent;
          if (nextDirty !== liveTab.isDirty) {
            snapshotViewerTabEditorContent(path, text, nextDirty);
            updateViewerChrome();
          }
        }),
        ...editorCoreExtensions({
          wordWrap: editorSettings.wordWrap,
          tabSize: editorSettings.tabSize,
          renderWhitespace: editorSettings.renderWhitespace,
        }),
        ...fileEditorKeymapExtensions(),
        ...aiExts,
        ...quickEditExts,
        ...intentExts,
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void saveCurrentFile();
              return true;
            },
          },
        ]),
        EditorView.theme({
          '&': { height: '100%', fontSize: `${editorSettings.fontSize}px` },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
          '.cm-content': { caretColor: 'var(--mn-fg)' },
        }),
        ...minnowEditorExtensions(),
        ...langExts,
      ],
    });
    if (generation !== mountGeneration) return;
    if (getActiveViewerTabPath() !== path || !editorMount.isConnected) return;
    editorView = new EditorView({ state, parent: editorMount });
    editorViewPath = path;
    if (intentExts.length > 0) {
      mountIntentModeEditor(editorView, intentInitialEnabled);
      updateIntentToolbarChrome(intentInitialEnabled, 0);
    }
    syncIntentToolbarAvailability(tab);

    if (tab.pendingInitialLineRange && editorView) {
      const { startLine, endLine } = tab.pendingInitialLineRange;
      tab.pendingInitialLineRange = null;
      const doc = editorView.state.doc;
      const fromLine = Math.max(1, Math.min(startLine, doc.lines));
      const toLine = Math.max(fromLine, Math.min(endLine, doc.lines));
      const from = doc.line(fromLine).from;
      const to = doc.line(toLine).to;
      editorView.dispatch({
        selection: EditorSelection.range(from, to),
        scrollIntoView: true,
      });
      editorView.focus();
    } else if (tab.pendingInitialSelection && editorView) {
      const { line, character } = tab.pendingInitialSelection;
      tab.pendingInitialSelection = null;
      const doc = editorView.state.doc;
      const lineNumber = Math.min(line + 1, doc.lines);
      const lineInfo = doc.line(lineNumber);
      const col = Math.min(character, lineInfo.length);
      const anchor = lineInfo.from + col;
      editorView.dispatch({
        selection: EditorSelection.cursor(anchor),
        scrollIntoView: true,
      });
      editorView.focus();
    } else if (getActiveViewerTabPath() === path) {
      editorView.focus();
    }

    if (useLsp) {
      lspSyncedPath = path;
      void notifyLspDocument(path, 'open', content);
    }
    updateViewerChrome();
  })();
}

function mountImagePreview(tab: ViewerTabState, src: string, onImageError?: () => void): void {
  const host = getViewerHost();
  if (!host) return;
  destroyEditor();
  host.innerHTML = '';

  const banner = document.createElement('p');
  banner.id = 'fileViewerReadOnlyBanner';
  banner.className = 'file-viewer-readonly-banner';
  banner.textContent = readOnlyBannerMessage(tab);
  host.appendChild(banner);

  const figure = document.createElement('figure');
  figure.className = 'file-viewer-image-preview';
  const img = document.createElement('img');
  img.src = src;
  img.alt = tab.displayName;
  if (onImageError) {
    img.onerror = onImageError;
  }
  figure.appendChild(img);
  host.appendChild(figure);
  updateViewerChrome();
}

export function setViewerLoading(_path: string): void {
  const host = getViewerHost();
  if (host) {
    destroyEditor();
    host.innerHTML = '<p class="file-viewer-status">Loading…</p>';
  }
  const saveBtn = getSaveButton();
  if (saveBtn) saveBtn.disabled = true;
}

export function setViewerError(message: string): void {
  const host = getViewerHost();
  if (host) {
    destroyEditor();
    host.innerHTML = `<p class="file-viewer-status file-viewer-error">${escapeHtml(message)}</p>`;
  }
  const saveBtn = getSaveButton();
  if (saveBtn) saveBtn.disabled = true;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface LoadedFileContent {
  content: string;
  readOnlyExcerpt: boolean;
}

async function loadFileContent(path: string): Promise<LoadedFileContent> {
  const raw = (await executeTool('read_file', { path })).content;
  if (raw.startsWith('Error:')) {
    throw new Error(raw.replace(/^Error:\s*/i, '').trim());
  }

  if (raw.length > LARGE_FILE_BYTES) {
    const rangeRaw = (
      await executeTool('read_file_range', {
        path,
        start_line: 1,
        end_line: RANGE_LINE_COUNT,
      })
    ).content;
    if (rangeRaw.startsWith('Error:')) {
      throw new Error(rangeRaw.replace(/^Error:\s*/i, '').trim());
    }
    const body = parseReadFileRangeBody(rangeRaw);
    return {
      content: body + buildLargeFileExcerptFooter(raw.length),
      readOnlyExcerpt: true,
    };
  }

  return { content: raw, readOnlyExcerpt: false };
}

/** Load workspace file content for the active tab when needed. */
async function ensureActiveTabLoaded(): Promise<void> {
  const tab = getActiveViewerTab();
  if (!tab || tab.loadStatus !== 'loading' || tab.kind === 'attachment') return;

  setViewerLoading(tab.path);
  try {
    if (isImageFilePath(tab.path)) {
      setActiveTabLoadState('ready', { viewMode: 'image' });
      renderActiveViewerTab();
      return;
    }
    const loaded = await loadFileContent(tab.path);
    const viewMode = tab.viewMode === 'markdown-preview' ? 'markdown-preview' : 'editor';
    setActiveTabLoadState('ready', {
      content: loaded.content,
      readOnlyExcerpt: loaded.readOnlyExcerpt,
      viewMode,
    });
    renderActiveViewerTab();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setActiveTabLoadState('error', { error: message });
    setViewerError(message || 'Could not open file');
  }
}

/** Mount the active tab in #fileViewerHost (editor, preview, image, loading, error). */
export function renderActiveViewerTab(): void {
  const tab = getActiveViewerTab();
  const host = getViewerHost();
  if (!tab || !host) {
    if (host) host.innerHTML = '';
    destroyEditor();
    updateViewerChrome();
    return;
  }

  if (tab.loadStatus === 'loading') {
    setViewerLoading(tab.path);
    void ensureActiveTabLoaded();
    return;
  }

  if (tab.loadStatus === 'error') {
    setViewerError(tab.loadError ?? 'Could not open file');
    return;
  }

  const content = activeTabContent(tab);

  if (tab.viewMode === 'image') {
    if (tab.kind === 'attachment') {
      mountImagePreview(tab, content);
    } else {
      const src = resolvePreviewLoadUrl({ kind: 'workspace', path: tab.path });
      mountImagePreview(tab, src, () => {
        setViewerError(
          'Could not load image preview. Is the tool server running (npm start)?',
        );
      });
    }
    return;
  }

  if (tab.viewMode === 'markdown-preview') {
    mountMarkdownPreview(tab, content);
    return;
  }

  mountEditor(tab, content);
}

/** Confirm when leaving a dirty active editor tab. */
export function confirmLeaveDirtyActiveTab(): boolean {
  const tab = getActiveViewerTab();
  if (!tab?.isDirty) return true;
  return window.confirm('You have unsaved changes. Continue without saving?');
}

async function activateTabAndRender(path: string, options?: { skipUnsavedGuard?: boolean }): Promise<boolean> {
  const ok = activateViewerTab(path, {
    skipUnsavedGuard: options?.skipUnsavedGuard,
    confirmUnsaved: confirmLeaveDirtyActiveTab,
    beforeActivate: snapshotOutgoingEditorTab,
  });
  if (!ok) return false;
  renderActiveViewerTab();
  renderFileTreeViaBridge();
  return true;
}

/** Close a single tab by path (with unsaved confirm). */
export async function closeViewerTab(path: string): Promise<void> {
  const tab = listViewerTabs().find((t) => t.path === path);
  if (!tab) return;

  if (path === getActiveViewerTabPath() && tab.isDirty) {
    const proceed = window.confirm('You have unsaved changes. Close without saving?');
    if (!proceed) return;
  } else if (tab.isDirty) {
    const proceed = window.confirm('You have unsaved changes. Close without saving?');
    if (!proceed) return;
  }

  const wasActive = path === getActiveViewerTabPath();
  if (wasActive) {
    destroyEditor();
  }
  removeViewerTab(path);

  if (listViewerTabs().length === 0) {
    patchFilePanelState({ openViewerTabs: [], activeViewerTab: null, selectedPath: null });
    hideViewerSplit();
    const host = getViewerHost();
    if (host) host.innerHTML = '';
  } else if (wasActive) {
    renderActiveViewerTab();
  }
  renderFileTreeViaBridge();
}

/** Persist the open file via save_file. */
export async function saveCurrentFile(): Promise<boolean> {
  const tab = getActiveViewerTab();
  if (!tab || !editorView || tab.readOnlyExcerpt || !tab.isDirty || isSaving) {
    return false;
  }

  const content = editorView.state.doc.toString();
  isSaving = true;
  updateViewerChrome();

  try {
    const raw = (await executeTool('save_file', { path: tab.path, content })).content;
    if (raw.startsWith('Error:')) {
      throw new Error(raw.replace(/^Error:\s*/i, '').trim());
    }
    markActiveTabSaved(content);
    if (lspSyncedPath === tab.path) {
      void notifyLspDocument(tab.path, 'change', content);
    }
    await refreshFileTreeViaBridge();
    const { emitFileSaved } = await import('../state/preview-events');
    emitFileSaved(tab.path);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    window.alert(message || 'Could not save file');
    return false;
  } finally {
    isSaving = false;
    updateViewerChrome();
  }
}

/** Switch the open markdown file from preview to the editable code editor. */
export function switchMarkdownViewerToCode(): void {
  const tab = getActiveViewerTab();
  if (!tab || !isMarkdownFilePath(tab.path) || tab.viewMode !== 'markdown-preview') return;
  tab.viewMode = 'editor';
  tab.cachedEditorContent = tab.originalContent;
  renderActiveViewerTab();
}

/** Switch the open markdown file from the code editor to GFM preview. */
export function switchMarkdownViewerToPreview(): void {
  const tab = getActiveViewerTab();
  if (!tab || !isMarkdownFilePath(tab.path) || !editorView) return;
  if (tab.isDirty) {
    const proceed = window.confirm(
      'You have unsaved changes. Switch to preview without saving?',
    );
    if (!proceed) return;
  }
  const content = editorView.state.doc.toString();
  tab.originalContent = content;
  tab.cachedEditorContent = content;
  tab.isDirty = false;
  tab.viewMode = 'markdown-preview';
  renderActiveViewerTab();
}

/** Wire Save button and tab handlers (call once from init-file-panel). */
export function bindFileViewerControls(): void {
  if (viewerControlsBound) return;
  viewerControlsBound = true;

  registerFileViewerTabHandlers({
    onActivate: (path) => {
      void activateTabAndRender(path);
    },
    onClose: (path) => {
      void closeViewerTab(path);
    },
  });

  setLspDiagnosticsChromeListener((counts) => {
    updateDiagnosticsChrome({ errors: counts.errors, warnings: counts.warnings });
  });

  const saveBtn = getSaveButton();
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      void saveCurrentFile();
    });
  }

  editorIntentToggleEl = getIntentToggleButton();
  editorIntentStatusEl = getIntentStatusElement();
  if (editorIntentToggleEl) {
    editorIntentToggleEl.addEventListener('click', () => {
      if (!editorView || !getLocalServerAvailable()) return;
      toggleIntentMode(editorView);
    });
  }

  const closeBtn = document.getElementById('btnFileViewerClose');
  if (closeBtn) {
    closeBtn.setAttribute('aria-label', 'Close tab');
    closeBtn.setAttribute('title', 'Close tab');
  }

  window.addEventListener(EDITOR_AI_CONFIG_CHANGED_EVENT, () => {
    const tab = getActiveViewerTab();
    if (!tab || tab.viewMode !== 'editor' || tab.loadStatus !== 'ready') return;
    renderActiveViewerTab();
  });
}

/** Right-click on the viewer: selection → chat / quick edit; markdown preview toggles. */
export function bindFileViewerContextMenu(): void {
  if (viewerContextMenuBound) return;
  const host = getViewerHost();
  if (!host) return;
  viewerContextMenuBound = true;

  host.addEventListener('contextmenu', (e) => {
    const tab = getActiveViewerTab();
    if (!tab) return;

    const hasEditorSelection = Boolean(
      editorView &&
        !tab.readOnlyExcerpt &&
        tab.viewMode === 'editor' &&
        !editorView.state.selection.main.empty,
    );
    const isMarkdown = isMarkdownFilePath(tab.path);
    const isPreview = isMarkdownPreviewActive();

    if (!hasEditorSelection && !isMarkdown) return;

    e.preventDefault();

    const items = buildFileViewerContextMenuItems({
      path: tab.path,
      hasEditorSelection,
      isMarkdown,
      isMarkdownPreview: isPreview,
      onAddSelectionToChat: () => {
        if (!editorView || tab.readOnlyExcerpt) return;
        const sel = editorView.state.selection.main;
        const text = editorView.state.doc.sliceString(sel.from, sel.to);
        const { fromLine, toLine } = lineNumbersForRange(
          editorView.state.doc,
          sel.from,
          sel.to,
        );
        addCodeReferenceToComposer({
          workspacePath: tab.path,
          startLine: fromLine,
          endLine: toLine,
          text,
        });
      },
      onQuickEdit: () => {
        if (!editorView || tab.readOnlyExcerpt) return;
        openQuickEditPanel(editorView, tab.path);
      },
      onSwitchToCode: () => switchMarkdownViewerToCode(),
      onSwitchToPreview: () => switchMarkdownViewerToPreview(),
    });

    if (items.length === 0) return;
    showFilePanelContextMenu(items, e.clientX, e.clientY);
  });
}

/** Active CodeMirror view when the code editor (not markdown preview) is mounted. */
export function getFileViewerEditorView(): EditorView | null {
  return editorView;
}

export interface OpenFileInViewerOptions {
  skipUnsavedGuard?: boolean;
  asCode?: boolean;
  initialSelection?: { line: number; character: number };
  initialLineRange?: { startLine: number; endLine: number };
}

function openTabOptionsFromViewerOptions(
  options?: OpenFileInViewerOptions,
): OpenViewerTabOptions {
  return {
    skipUnsavedGuard: options?.skipUnsavedGuard,
    asCode: options?.asCode,
    initialSelection: options?.initialSelection,
    initialLineRange: options?.initialLineRange,
    viewMode: undefined,
  };
}

/** Open inlined chat attachment text in a read-only editor pane. */
export function openAttachmentSnapshotInViewer(displayName: string, content: string): void {
  const safeName = displayName.replace(/[/\\]/g, '_') || 'attachment';
  const path = `.minnow/attachments/${safeName}`;

  const result = openViewerTab(path, {
    kind: 'attachment',
    displayName,
    content,
    readOnlyExcerpt: true,
    readOnlyBannerText: 'Chat attachment snapshot (read-only; not saved to the project).',
    viewMode: shouldUseMarkdownPreview(path) ? 'markdown-preview' : 'editor',
    confirmUnsaved: confirmLeaveDirtyActiveTab,
    skipUnsavedGuard: false,
    beforeActivate: snapshotOutgoingEditorTab,
  });
  if (!result) return;

  showViewerSplit();
  renderActiveViewerTab();
  renderFileTreeViaBridge();
}

/** Open a workspace image via the preview file API (binary-safe). */
export function openWorkspaceImageInViewer(relativePath: string): void {
  const displayName = relativePath.split(/[/\\]/).pop() ?? relativePath;
  const result = openViewerTab(relativePath, {
    viewMode: 'image',
    readOnlyExcerpt: true,
    readOnlyBannerText: 'Workspace image (read-only preview).',
    content: '',
    confirmUnsaved: confirmLeaveDirtyActiveTab,
    beforeActivate: snapshotOutgoingEditorTab,
  });
  if (!result) return;
  showViewerSplit();
  renderActiveViewerTab();
  renderFileTreeViaBridge();
}

/** Open an image data URL from a chat attachment in the viewer pane. */
export function openImageDataUrlInViewer(displayName: string, dataUrl: string): void {
  const safeName = displayName.replace(/[/\\]/g, '_') || 'image';
  const path = `.minnow/attachments/${safeName}`;

  const result = openViewerTab(path, {
    kind: 'attachment',
    displayName,
    content: dataUrl,
    viewMode: 'image',
    readOnlyExcerpt: true,
    readOnlyBannerText: 'Chat image attachment (read-only preview).',
    confirmUnsaved: confirmLeaveDirtyActiveTab,
    beforeActivate: snapshotOutgoingEditorTab,
  });
  if (!result) return;
  showViewerSplit();
  renderActiveViewerTab();
  renderFileTreeViaBridge();
}

/** Open a project file in the split viewer. */
export async function openFileInViewer(
  relativePath: string,
  options?: OpenFileInViewerOptions,
): Promise<void> {
  if (isImageFilePath(relativePath)) {
    openWorkspaceImageInViewer(relativePath);
    return;
  }

  const viewMode = shouldUseMarkdownPreview(relativePath, options?.asCode)
    ? 'markdown-preview'
    : 'editor';

  const result = openViewerTab(relativePath, {
    ...openTabOptionsFromViewerOptions(options),
    viewMode,
    confirmUnsaved: options?.skipUnsavedGuard ? undefined : confirmLeaveDirtyActiveTab,
    skipUnsavedGuard: options?.skipUnsavedGuard,
    beforeActivate: snapshotOutgoingEditorTab,
  });

  if (!result) {
    if (listViewerTabs().length >= MAX_OPEN_VIEWER_TABS) {
      setStatus('err', `At most ${MAX_OPEN_VIEWER_TABS} files can be open in the viewer.`);
    }
    return;
  }

  showViewerSplit();
  renderFileTreeViaBridge();

  if (result.focusedExisting && result.tab.loadStatus === 'ready') {
    renderActiveViewerTab();
    return;
  }

  result.tab.loadStatus = 'loading';
  renderActiveViewerTab();
}

/** Restore persisted workspace tabs after boot (active tab loads first). */
export async function restoreViewerTabsFromPrefs(
  paths: string[],
  activePath: string | null,
): Promise<void> {
  if (paths.length === 0) return;
  restoreWorkspaceViewerTabs(paths, activePath);
  showViewerSplit();
  renderFileTreeViaBridge();
  renderActiveViewerTab();
}

function resetAllViewerTabs(options?: { closeSplit?: boolean }): void {
  destroyEditor();
  clearAllViewerTabs();
  const host = getViewerHost();
  if (host) host.innerHTML = '';
  const saveBtn = getSaveButton();
  if (saveBtn) saveBtn.disabled = true;
  if (options?.closeSplit !== false) {
    hideViewerSplit();
  } else {
    hideViewerPaneDom();
  }
  renderFileTreeViaBridge();
}

/** Close active tab; hide split when no tabs remain. */
export function closeFileViewer(): void {
  const path = getActiveViewerTabPath();
  if (!path) return;
  void closeViewerTab(path);
}

/** Dismiss all file viewer tabs when switching to preview. */
export function dismissFileViewerForPreview(): boolean {
  if (isAnyViewerTabDirty()) {
    const proceed = window.confirm('You have unsaved changes. Close without saving?');
    if (!proceed) return false;
  }
  resetAllViewerTabs({ closeSplit: false });
  return true;
}

/** Close all tabs without unsaved prompt (paths removed on disk). */
export function closeFileViewerForce(): void {
  resetAllViewerTabs();
}

/** Update open path after rename/move without reloading editor content. */
export function retargetOpenViewerPath(newPath: string): void {
  const active = getActiveViewerTabPath();
  if (!active) return;
  retargetViewerTab(active, newPath);
  renderActiveViewerTab();
  renderFileTreeViaBridge();
}

export function getOpenViewerPath(): string | null {
  return getActiveViewerTabPath();
}

export function isFileViewerDirty(): boolean {
  const tab = getActiveViewerTab();
  return tab?.isDirty ?? false;
}

export { getOpenViewerTabPaths, isViewerTabDirty };
