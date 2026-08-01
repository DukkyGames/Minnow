/**
 * Secondary editor group for the right-pane split.
 *
 * Renders the secondary slot's own active tab into #fileViewerHostSecondary. It shares
 * the tab store with the primary group (one buffer per path, and a path only ever lives
 * in one slot), but keeps its own CodeMirror view, load trigger, and header chrome.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { setAssistantBubbleContent } from '../markdown/renderer';
import {
  getViewerTab,
  isViewerDocDirty,
  snapshotViewerTabEditorContent,
  type ViewerTabState,
} from './file-viewer-tab-store';
import { editorCoreExtensions } from './editor-core-extensions';
import { loadEditorSettings } from '../config/editor-settings';
import { loadEditorIntentModeConfig } from '../config/editor-intent-mode';
import { loadLanguageExtensionsForPath } from './editor-language';
import { minnowEditorExtensions } from './codemirror-theme';
import { notifyLspDocument } from '../lsp/completion-client';
import { resolveDocumentHtmlLoadUrl, resolvePreviewLoadUrl } from './preview-load-url';
import { getFileTreeListingWorkspaceRoot } from './file-tree-listing-root';
import { getLocalServerAvailable } from '../tools/client';
import {
  editorIntentModeExtensions,
  isIntentModeEnabled,
  mountIntentModeEditor,
} from './editor-intent-mode/extensions';
import {
  ensureViewerTabLoaded,
  isIntentModeEnabledForViewerPath,
  rememberIntentModeEnabledForPath,
  registerSecondaryEditorSnapshot,
  saveViewerTabByPath,
  syncSecondaryIntentToolbarChrome,
  updateSecondaryViewerChrome,
} from './file-viewer';
import { codeSelectionDragExtension } from './editor-code-selection-drag';

let secondaryView: EditorView | null = null;
let secondaryPath: string | null = null;
let lspTimer: ReturnType<typeof setTimeout> | null = null;
/** What the secondary host is painting — guards against remounting on every layout pass. */
let renderKey: string | null = null;
let pendingMountPath: string | null = null;
let mountGeneration = 0;
let snapshotHookBound = false;

function getHost(): HTMLElement | null {
  return document.getElementById('fileViewerHostSecondary');
}

/** Persist the live secondary buffer into its tab (unsaved guard + save read this). */
export function snapshotSecondaryEditorTab(): void {
  if (!secondaryView || !secondaryPath) return;
  const tab = getViewerTab(secondaryPath);
  if (!tab || tab.viewMode === 'image') return;
  const text = secondaryView.state.doc.toString();
  const dirty = !tab.readOnlyExcerpt && isViewerDocDirty(text, tab.originalContent);
  snapshotViewerTabEditorContent(secondaryPath, text, dirty);
}

function bindSnapshotHook(): void {
  if (snapshotHookBound) return;
  snapshotHookBound = true;
  registerSecondaryEditorSnapshot(snapshotSecondaryEditorTab);
}

function destroySecondaryEditor(): void {
  if (lspTimer) {
    clearTimeout(lspTimer);
    lspTimer = null;
  }
  if (secondaryView) {
    snapshotSecondaryEditorTab();
    secondaryView.destroy();
    secondaryView = null;
  }
  if (secondaryPath) {
    void notifyLspDocument(secondaryPath, 'close');
  }
  secondaryPath = null;
  pendingMountPath = null;
}

/** Tear down the secondary editor (split closed or slot cleared). */
export function destroySecondaryViewerSlot(): void {
  destroySecondaryEditor();
  renderKey = null;
  const host = getHost();
  if (host) host.replaceChildren();
  updateSecondaryViewerChrome();
}

function renderKeyFor(tab: ViewerTabState): string {
  return `${tab.path}::${tab.viewMode}::${tab.loadStatus}`;
}

function renderIsCurrent(tab: ViewerTabState): boolean {
  if (renderKey !== renderKeyFor(tab)) return false;
  const host = getHost();
  if (!host || host.childElementCount === 0) return false;
  if (tab.viewMode === 'editor') {
    return (secondaryView !== null && secondaryPath === tab.path) || pendingMountPath === tab.path;
  }
  return true;
}

function showMessage(host: HTMLElement, message: string, isError = false): void {
  destroySecondaryEditor();
  const p = document.createElement('p');
  p.className = isError
    ? 'file-viewer-status file-viewer-error'
    : 'file-viewer-status';
  p.textContent = message;
  host.replaceChildren(p);
}

function appendReadOnlyBanner(host: HTMLElement, tab: ViewerTabState): void {
  if (!tab.readOnlyExcerpt) return;
  const banner = document.createElement('p');
  banner.className = 'file-viewer-readonly-banner';
  banner.textContent = tab.readOnlyBannerText ?? 'Read-only preview.';
  host.appendChild(banner);
}

function mountMarkdown(host: HTMLElement, tab: ViewerTabState, content: string): void {
  destroySecondaryEditor();
  host.replaceChildren();
  appendReadOnlyBanner(host, tab);
  const preview = document.createElement('div');
  preview.className = 'file-viewer-markdown-preview msg-bubble msg-bubble--md';
  host.appendChild(preview);
  setAssistantBubbleContent(preview, content, { streaming: false });
}

function mountImage(host: HTMLElement, tab: ViewerTabState, content: string): void {
  destroySecondaryEditor();
  host.replaceChildren();
  appendReadOnlyBanner(host, tab);
  const figure = document.createElement('figure');
  figure.className = 'file-viewer-image-preview';
  const img = document.createElement('img');
  img.src =
    tab.kind === 'attachment'
      ? content
      : resolvePreviewLoadUrl(
          { kind: 'workspace', path: tab.path },
          undefined,
          getFileTreeListingWorkspaceRoot(),
        );
  img.alt = tab.displayName;
  figure.appendChild(img);
  host.appendChild(figure);
}

function mountDocumentPreview(host: HTMLElement, tab: ViewerTabState): void {
  destroySecondaryEditor();
  host.replaceChildren();
  appendReadOnlyBanner(host, tab);
  const frame = document.createElement('iframe');
  frame.className = 'file-viewer-document-preview';
  frame.title = `${tab.displayName} preview`;
  frame.setAttribute('sandbox', '');
  frame.src =
    tab.viewMode === 'pdf'
      ? resolvePreviewLoadUrl(
          { kind: 'workspace', path: tab.path },
          undefined,
          getFileTreeListingWorkspaceRoot(),
        )
      : resolveDocumentHtmlLoadUrl(tab.path, undefined, getFileTreeListingWorkspaceRoot());
  host.appendChild(frame);
}

function mountEditor(host: HTMLElement, tab: ViewerTabState, content: string): void {
  const generation = ++mountGeneration;
  destroySecondaryEditor();
  host.replaceChildren();
  appendReadOnlyBanner(host, tab);

  const mount = document.createElement('div');
  mount.className = 'file-viewer-editor-mount';
  host.appendChild(mount);

  const path = tab.path;
  pendingMountPath = path;

  void (async () => {
    const editorSettings = await loadEditorSettings();
    const langExts = await loadLanguageExtensionsForPath(path);
    const intentConfig = await loadEditorIntentModeConfig();
    const intentInitialEnabled = isIntentModeEnabledForViewerPath(
      path,
      intentConfig.enabledByDefault,
    );
    const intentExts =
      !tab.readOnlyExcerpt && getLocalServerAvailable()
        ? editorIntentModeExtensions({
            filePath: path,
            config: intentConfig,
            canRequest: () => getLocalServerAvailable(),
            initialEnabled: intentInitialEnabled,
            onEnabledChange: (enabled) => {
              rememberIntentModeEnabledForPath(path, enabled);
              syncSecondaryIntentToolbarChrome(enabled, 0);
            },
            onStaleCount: (count) => {
              if (!secondaryView || secondaryPath !== path) return;
              syncSecondaryIntentToolbarChrome(isIntentModeEnabled(secondaryView.state), count);
            },
            onStatus: () => undefined,
          })
        : [];
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(tab.readOnlyExcerpt),
        EditorView.editable.of(!tab.readOnlyExcerpt),
        ...editorCoreExtensions({
          wordWrap: editorSettings.wordWrap,
          tabSize: editorSettings.tabSize,
          renderWhitespace: editorSettings.renderWhitespace,
        }),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              snapshotSecondaryEditorTab();
              void saveViewerTabByPath(path);
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
        ...intentExts,
        ...(tab.readOnlyExcerpt ? [] : [codeSelectionDragExtension(path)]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || secondaryPath !== path) return;
          const text = update.state.doc.toString();
          const liveTab = getViewerTab(path);
          if (!liveTab || liveTab.readOnlyExcerpt) return;
          snapshotViewerTabEditorContent(
            path,
            text,
            isViewerDocDirty(text, liveTab.originalContent),
          );
          updateSecondaryViewerChrome();
          if (lspTimer) clearTimeout(lspTimer);
          lspTimer = setTimeout(() => {
            void notifyLspDocument(path, 'change', text);
          }, 400);
        }),
      ],
    });
    if (generation !== mountGeneration || !mount.isConnected) return;
    if (pendingMountPath === path) pendingMountPath = null;
    secondaryPath = path;
    secondaryView = new EditorView({ state, parent: mount });
    if (!tab.readOnlyExcerpt && getLocalServerAvailable()) {
      mountIntentModeEditor(secondaryView, intentInitialEnabled);
    }
    void notifyLspDocument(path, 'open', content);
    updateSecondaryViewerChrome();
  })();
}

/** Mount the secondary slot's active tab (loads content on demand). */
export function renderSecondaryViewerSlot(tabPath: string | null): void {
  bindSnapshotHook();
  const host = getHost();
  if (!host) return;

  if (!tabPath) {
    destroySecondaryViewerSlot();
    showMessage(host, 'Open a file in this pane');
    return;
  }

  const tab = getViewerTab(tabPath);
  if (!tab) {
    destroySecondaryViewerSlot();
    showMessage(host, 'Open a file in this pane');
    return;
  }

  if (tab.loadStatus === 'loading') {
    if (secondaryPath !== tabPath) destroySecondaryEditor();
    renderKey = null;
    showMessage(host, 'Loading…');
    void ensureViewerTabLoaded(tabPath);
    return;
  }

  if (tab.loadStatus === 'error') {
    renderKey = null;
    showMessage(host, tab.loadError ?? 'Could not open file', true);
    return;
  }

  if (renderIsCurrent(tab)) return;
  renderKey = renderKeyFor(tab);

  const content = tab.cachedEditorContent ?? tab.originalContent;

  if (tab.viewMode === 'image') {
    mountImage(host, tab, content);
    return;
  }
  if (tab.viewMode === 'pdf' || tab.viewMode === 'spreadsheet' || tab.viewMode === 'word') {
    mountDocumentPreview(host, tab);
    return;
  }
  if (tab.viewMode === 'markdown-preview') {
    mountMarkdown(host, tab, content);
    return;
  }
  mountEditor(host, tab, content);
  updateSecondaryViewerChrome();
}

/** Live CodeMirror view of the secondary group, when one is mounted. */
export function getSecondaryViewerEditorView(): EditorView | null {
  return secondaryView;
}

/** Test helper — drop cached render identity so the next render remounts. */
export function invalidateSecondaryViewerRender(): void {
  renderKey = null;
}
