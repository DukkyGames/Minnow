/**
 * Editable file viewer (CodeMirror 6) using read_file / read_file_range / save_file tools.
 */

import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { isImageFilePath } from '../attachments/image-path';
import { setAssistantBubbleContent } from '../markdown/renderer';
import { executeTool, getLocalServerAvailable } from '../tools/client';
import { resolvePreviewLoadUrl } from './preview-panel';
import { fetchLspConfig } from '../lsp/config-client';
import { notifyLspDocument } from '../lsp/completion-client';
import { patchFilePanelState } from '../state/file-panel';
import {
  hideViewerPaneDom,
  hideViewerSplit,
  showViewerSplit,
} from './file-layout';
import { isMarkdownFilePath } from './file-markdown-path';
import {
  showFilePanelContextMenu,
} from './file-tree-context-menu';
import {
  refreshFileTreeViaBridge,
  renderFileTreeViaBridge,
} from './file-tree-refresh-bridge';
import { loadEditorAiCompletionConfig } from '../config/editor-ai-completion';
import { loadEditorSettings } from '../config/editor-settings';
import { minnowEditorExtensions } from './codemirror-theme';
import { editorCoreExtensions } from './editor-core-extensions';
import { loadLanguageExtensionsForPath } from './editor-language';
import { fileEditorKeymapExtensions } from './file-editor-keymap';
import { lspEditorExtensions } from './file-editor-extensions';
import { setLspDiagnosticsChromeListener } from './lsp-editor';
import { editorAiCompletionExtensions } from './file-editor-ai-extensions';
import { addCodeReferenceToComposer } from '../attachments/code-ref';
import {
  buildFileViewerContextMenuItems,
  editorQuickEditExtensions,
  lineNumbersForRange,
  openQuickEditPanel,
} from './editor-quick-edit';

export const LARGE_FILE_BYTES = 512_000;
const RANGE_LINE_COUNT = 2000;
const LSP_CHANGE_DEBOUNCE_MS = 400;

/** Footer appended when only a range of a large file is loaded. */
export const LARGE_FILE_EXCERPT_FOOTER_RE =
  /\n\n\/\* Showing lines 1–\d+ only \(\d+ bytes total\)\. \*\/\s*$/;

let editorView: EditorView | null = null;
let markdownPreviewEl: HTMLElement | null = null;
let currentPath: string | null = null;
let originalContent = '';
let isDirty = false;
let readOnlyExcerpt = false;
/** Overrides the large-file banner when opening chat attachment snapshots. */
let readOnlyBannerText: string | null = null;
let isSaving = false;
let viewerControlsBound = false;
let viewerContextMenuBound = false;
let lspSyncedPath: string | null = null;
let lspChangeTimer: ReturnType<typeof setTimeout> | null = null;
let editorAiStatusEl: HTMLElement | null = null;
let diagnosticsBadgeEl: HTMLElement | null = null;
let pendingInitialSelection: { line: number; character: number } | null = null;
let pendingInitialLineRange: { startLine: number; endLine: number } | null = null;

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
  return markdownPreviewEl !== null;
}

function buildLargeFileExcerptFooter(byteLength: number): string {
  return `\n\n/* Showing lines 1–${RANGE_LINE_COUNT} only (${byteLength} bytes total). */`;
}

function getViewerHost(): HTMLElement | null {
  return document.getElementById('fileViewerHost');
}

function getPathLabel(): HTMLElement | null {
  return document.getElementById('fileViewerPath');
}

function getSaveButton(): HTMLButtonElement | null {
  return document.getElementById('btnFileViewerSave') as HTMLButtonElement | null;
}

function getReadOnlyBanner(): HTMLElement | null {
  return document.getElementById('fileViewerReadOnlyBanner');
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

function destroyEditor(): void {
  closeLspDocument();
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
  markdownPreviewEl = null;
}

function markDirty(dirty: boolean): void {
  isDirty = dirty;
  updateViewerChrome();
}

function ensureDiagnosticsBadge(): HTMLElement | null {
  const label = getPathLabel();
  if (!label?.parentElement) return null;
  if (!diagnosticsBadgeEl) {
    diagnosticsBadgeEl = document.createElement('span');
    diagnosticsBadgeEl.className = 'file-viewer-diagnostics';
    diagnosticsBadgeEl.hidden = true;
    label.insertAdjacentElement('afterend', diagnosticsBadgeEl);
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
  const label = getPathLabel();
  if (label && currentPath) {
    label.textContent = formatViewerPathLabel(currentPath, isDirty);
    label.classList.toggle('file-viewer-path--dirty', isDirty);
  }

  const saveBtn = getSaveButton();
  if (saveBtn) {
    const canSave = Boolean(currentPath && editorView && isDirty && !readOnlyExcerpt && !isSaving);
    saveBtn.disabled = !canSave;
    saveBtn.classList.toggle('file-viewer-save--active', canSave);
    saveBtn.setAttribute('aria-busy', isSaving ? 'true' : 'false');
  }

  const banner = getReadOnlyBanner();
  if (banner) {
    banner.hidden = !readOnlyExcerpt;
    if (readOnlyExcerpt && readOnlyBannerText) {
      banner.textContent = readOnlyBannerText;
    }
  }
}

function readOnlyBannerMessage(): string {
  if (readOnlyBannerText) return readOnlyBannerText;
  return `Read-only preview: file is larger than ${LARGE_FILE_BYTES.toLocaleString()} bytes; showing lines 1–${RANGE_LINE_COUNT} only.`;
}

function mountMarkdownPreview(content: string): void {
  const host = getViewerHost();
  if (!host) return;
  destroyEditor();
  host.innerHTML = '';

  if (readOnlyExcerpt) {
    const banner = document.createElement('p');
    banner.id = 'fileViewerReadOnlyBanner';
    banner.className = 'file-viewer-readonly-banner';
    banner.textContent = readOnlyBannerMessage();
    host.appendChild(banner);
  }

  const preview = document.createElement('div');
  preview.className = 'file-viewer-markdown-preview msg-bubble msg-bubble--md';
  host.appendChild(preview);
  markdownPreviewEl = preview;
  setAssistantBubbleContent(preview, content, { streaming: false });
  updateViewerChrome();
}

function mountEditor(content: string, path: string): void {
  const host = getViewerHost();
  if (!host) return;
  destroyEditor();
  host.innerHTML = '';

  if (readOnlyExcerpt) {
    const banner = document.createElement('p');
    banner.id = 'fileViewerReadOnlyBanner';
    banner.className = 'file-viewer-readonly-banner';
    banner.textContent = readOnlyBannerMessage();
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

  void (async () => {
    const [langExts, useLsp, editorAiConfig, editorSettings] = await Promise.all([
      loadLanguageExtensionsForPath(path),
      isLspEnabledForViewer(),
      loadEditorAiCompletionConfig(),
      loadEditorSettings(),
    ]);
    const readOnlyExts: Extension[] = readOnlyExcerpt
      ? [EditorView.editable.of(false), EditorState.readOnly.of(true)]
      : [];
    const lspExts = useLsp ? lspEditorExtensions(path) : [];
    const useEditorAi =
      editorAiConfig.enabled && !readOnlyExcerpt && getLocalServerAvailable();
    const aiExts = useEditorAi
      ? editorAiCompletionExtensions({
          filePath: path,
          config: editorAiConfig,
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
    const quickEditExts =
      !readOnlyExcerpt && getLocalServerAvailable()
        ? editorQuickEditExtensions({
            filePath: path,
            canRequest: () => getLocalServerAvailable(),
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
          if (readOnlyExcerpt) return;
          const nextDirty = text !== originalContent;
          if (nextDirty !== isDirty) {
            markDirty(nextDirty);
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
        }),
        ...minnowEditorExtensions(),
        ...langExts,
      ],
    });
    editorView = new EditorView({ state, parent: editorMount });
    if (pendingInitialLineRange && editorView) {
      const { startLine, endLine } = pendingInitialLineRange;
      pendingInitialLineRange = null;
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
    } else if (pendingInitialSelection && editorView) {
      const { line, character } = pendingInitialSelection;
      pendingInitialSelection = null;
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
    }
    if (useLsp) {
      lspSyncedPath = path;
      void notifyLspDocument(path, 'open', content);
    }
    updateViewerChrome();
  })();
}

export function setViewerLoading(path: string): void {
  const label = getPathLabel();
  if (label) {
    label.textContent = path;
    label.classList.remove('file-viewer-path--dirty');
  }
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

/** Persist the open file via save_file. */
export async function saveCurrentFile(): Promise<boolean> {
  if (!currentPath || !editorView || readOnlyExcerpt || !isDirty || isSaving) {
    return false;
  }

  const content = editorView.state.doc.toString();
  isSaving = true;
  updateViewerChrome();

  try {
    const raw = (await executeTool('save_file', { path: currentPath, content })).content;
    if (raw.startsWith('Error:')) {
      throw new Error(raw.replace(/^Error:\s*/i, '').trim());
    }
    originalContent = content;
    markDirty(false);
    if (lspSyncedPath === currentPath) {
      void notifyLspDocument(currentPath, 'change', content);
    }
    await refreshFileTreeViaBridge();
    const { emitFileSaved } = await import('../state/preview-events');
    emitFileSaved(currentPath);
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
  if (!currentPath || !isMarkdownFilePath(currentPath) || editorView) return;
  mountEditor(originalContent, currentPath);
}

/** Switch the open markdown file from the code editor to GFM preview. */
export function switchMarkdownViewerToPreview(): void {
  if (!currentPath || !isMarkdownFilePath(currentPath) || !editorView) return;
  if (isDirty) {
    const proceed = window.confirm(
      'You have unsaved changes. Switch to preview without saving?',
    );
    if (!proceed) return;
  }
  const content = editorView.state.doc.toString();
  originalContent = content;
  isDirty = false;
  mountMarkdownPreview(content);
}

/** Wire Save button (call once from init-file-panel). */
export function bindFileViewerControls(): void {
  if (viewerControlsBound) return;
  viewerControlsBound = true;

  setLspDiagnosticsChromeListener((counts) => {
    updateDiagnosticsChrome({ errors: counts.errors, warnings: counts.warnings });
  });

  const saveBtn = getSaveButton();
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      void saveCurrentFile();
    });
  }
}

/** Right-click on the viewer: selection → chat / quick edit; markdown preview toggles. */
export function bindFileViewerContextMenu(): void {
  if (viewerContextMenuBound) return;
  const host = getViewerHost();
  if (!host) return;
  viewerContextMenuBound = true;

  host.addEventListener('contextmenu', (e) => {
    const path = currentPath;
    if (!path) return;

    const hasEditorSelection = Boolean(
      editorView &&
        !readOnlyExcerpt &&
        !markdownPreviewEl &&
        !editorView.state.selection.main.empty,
    );
    const isMarkdown = isMarkdownFilePath(path);
    const isPreview = isMarkdownPreviewActive();

    if (!hasEditorSelection && !isMarkdown) return;

    e.preventDefault();

    const items = buildFileViewerContextMenuItems({
      path,
      hasEditorSelection,
      isMarkdown,
      isMarkdownPreview: isPreview,
      onAddSelectionToChat: () => {
        if (!editorView || readOnlyExcerpt) return;
        const sel = editorView.state.selection.main;
        const text = editorView.state.doc.sliceString(sel.from, sel.to);
        const { fromLine, toLine } = lineNumbersForRange(
          editorView.state.doc,
          sel.from,
          sel.to,
        );
        addCodeReferenceToComposer({
          workspacePath: path,
          startLine: fromLine,
          endLine: toLine,
          text,
        });
      },
      onQuickEdit: () => {
        if (!editorView || readOnlyExcerpt) return;
        openQuickEditPanel(editorView, path);
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
  /** Open `.md` / `.markdown` in CodeMirror instead of read-only GFM preview. */
  asCode?: boolean;
  /** Move cursor after mount (0-based LSP line/character). */
  initialSelection?: { line: number; character: number };
  /** Select a 1-based inclusive line range after mount (editor selections). */
  initialLineRange?: { startLine: number; endLine: number };
}

/** Open inlined chat attachment text in a read-only editor pane. */
export function openAttachmentSnapshotInViewer(displayName: string, content: string): void {
  const safeName = displayName.replace(/[/\\]/g, '_') || 'attachment';
  const path = `.minnow/attachments/${safeName}`;

  if (isDirty && currentPath && currentPath !== path) {
    const proceed = window.confirm('You have unsaved changes. Open another file anyway?');
    if (!proceed) return;
  }

  currentPath = path;
  originalContent = content;
  isDirty = false;
  readOnlyExcerpt = true;
  readOnlyBannerText = 'Chat attachment snapshot (read-only; not saved to the project).';
  patchFilePanelState({ selectedPath: path });
  showViewerSplit();

  const label = getPathLabel();
  if (label) {
    label.textContent = displayName;
    label.classList.remove('file-viewer-path--dirty');
  }

  if (isMarkdownFilePath(path)) {
    mountMarkdownPreview(content);
  } else {
    mountEditor(content, path);
  }
  updateViewerChrome();
}

interface MountImagePreviewOptions {
  src: string;
  displayName: string;
  bannerText: string;
  /** Virtual path for selection state (workspace path or attachment snapshot). */
  statePath: string;
  onImageError?: () => void;
}

/** Renders a read-only image preview in the file viewer host. */
function mountImagePreviewInViewer(options: MountImagePreviewOptions): void {
  const { src, displayName, bannerText, statePath, onImageError } = options;

  currentPath = statePath;
  originalContent = '';
  isDirty = false;
  readOnlyExcerpt = true;
  readOnlyBannerText = bannerText;
  patchFilePanelState({ selectedPath: statePath });
  showViewerSplit();
  closeLspDocument();

  const label = getPathLabel();
  if (label) {
    label.textContent = displayName;
    label.classList.remove('file-viewer-path--dirty');
  }

  const host = getViewerHost();
  if (!host) return;
  destroyEditor();
  host.innerHTML = '';

  const banner = document.createElement('p');
  banner.id = 'fileViewerReadOnlyBanner';
  banner.className = 'file-viewer-readonly-banner';
  banner.textContent = readOnlyBannerMessage();
  host.appendChild(banner);

  const figure = document.createElement('figure');
  figure.className = 'file-viewer-image-preview';
  const img = document.createElement('img');
  img.src = src;
  img.alt = displayName;
  if (onImageError) {
    img.onerror = onImageError;
  }
  figure.appendChild(img);
  host.appendChild(figure);
  updateViewerChrome();
}

/** Open a workspace image via the preview file API (binary-safe). */
export function openWorkspaceImageInViewer(relativePath: string): void {
  const displayName = relativePath.split(/[/\\]/).pop() ?? relativePath;
  const src = resolvePreviewLoadUrl({ kind: 'workspace', path: relativePath });
  mountImagePreviewInViewer({
    src,
    displayName,
    statePath: relativePath,
    bannerText: 'Workspace image (read-only preview).',
    onImageError: () => {
      setViewerError('Could not load image preview. Is the tool server running (npm start)?');
    },
  });
}

/** Open an image data URL from a chat attachment in the viewer pane. */
export function openImageDataUrlInViewer(displayName: string, dataUrl: string): void {
  const safeName = displayName.replace(/[/\\]/g, '_') || 'image';
  const path = `.minnow/attachments/${safeName}`;

  if (isDirty && currentPath && currentPath !== path) {
    const proceed = window.confirm('You have unsaved changes. Open another file anyway?');
    if (!proceed) return;
  }

  mountImagePreviewInViewer({
    src: dataUrl,
    displayName,
    statePath: path,
    bannerText: 'Chat image attachment (read-only preview).',
  });
}

/** Open a project file in the split viewer. */
export async function openFileInViewer(
  relativePath: string,
  options?: OpenFileInViewerOptions,
): Promise<void> {
  if (
    !options?.skipUnsavedGuard &&
    isDirty &&
    currentPath &&
    currentPath !== relativePath
  ) {
    const proceed = window.confirm('You have unsaved changes. Open another file anyway?');
    if (!proceed) return;
  }

  currentPath = relativePath;
  isDirty = false;
  readOnlyExcerpt = false;
  readOnlyBannerText = null;
  pendingInitialSelection = options?.initialSelection ?? null;
  pendingInitialLineRange = options?.initialLineRange ?? null;
  patchFilePanelState({ selectedPath: relativePath });
  showViewerSplit();
  renderFileTreeViaBridge();

  if (isImageFilePath(relativePath)) {
    openWorkspaceImageInViewer(relativePath);
    return;
  }

  setViewerLoading(relativePath);

  try {
    const loaded = await loadFileContent(relativePath);
    originalContent = loaded.content;
    readOnlyExcerpt = loaded.readOnlyExcerpt;
    isDirty = false;
    if (shouldUseMarkdownPreview(relativePath, options?.asCode)) {
      mountMarkdownPreview(loaded.content);
    } else {
      mountEditor(loaded.content, relativePath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setViewerError(message || 'Could not open file');
  }
}

function resetViewerPane(options?: { closeSplit?: boolean }): void {
  currentPath = null;
  originalContent = '';
  isDirty = false;
  readOnlyExcerpt = false;
  readOnlyBannerText = null;
  patchFilePanelState({ selectedPath: null });
  destroyEditor();
  const host = getViewerHost();
  if (host) host.innerHTML = '';
  const label = getPathLabel();
  if (label) {
    label.textContent = '';
    label.classList.remove('file-viewer-path--dirty');
  }
  const saveBtn = getSaveButton();
  if (saveBtn) saveBtn.disabled = true;
  if (options?.closeSplit !== false) {
    hideViewerSplit();
  } else {
    hideViewerPaneDom();
  }
  renderFileTreeViaBridge();
}

/** Close viewer pane and clear selection. */
export function closeFileViewer(): void {
  if (isDirty) {
    const proceed = window.confirm('You have unsaved changes. Close without saving?');
    if (!proceed) return;
  }
  resetViewerPane();
}

/** Dismiss file viewer when switching to preview (keeps right split open). */
export function dismissFileViewerForPreview(): boolean {
  if (isDirty) {
    const proceed = window.confirm('You have unsaved changes. Close without saving?');
    if (!proceed) return false;
  }
  resetViewerPane({ closeSplit: false });
  return true;
}

/** Close viewer without unsaved prompt (path already removed on disk). */
export function closeFileViewerForce(): void {
  resetViewerPane();
}

/** Update open path after rename/move without reloading editor content. */
export function retargetOpenViewerPath(newPath: string): void {
  if (!currentPath) return;
  currentPath = newPath;
  patchFilePanelState({ selectedPath: newPath });
  updateViewerChrome();
  renderFileTreeViaBridge();
}

export function getOpenViewerPath(): string | null {
  return currentPath;
}

export function isFileViewerDirty(): boolean {
  return isDirty;
}
