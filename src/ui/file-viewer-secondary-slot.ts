/**
 * Secondary file viewer slot (CodeMirror) for right-pane split.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import {
  getViewerTab,
  isViewerDocDirty,
  snapshotViewerTabEditorContent,
} from './file-viewer-tab-store';
import { editorCoreExtensions } from './editor-core-extensions';
import { loadEditorSettings } from '../config/editor-settings';
import { loadLanguageExtensionsForPath } from './editor-language';
import { minnowEditorExtensions } from './codemirror-theme';
import { notifyLspDocument } from '../lsp/completion-client';

let secondaryView: EditorView | null = null;
let secondaryPath: string | null = null;
let lspTimer: ReturnType<typeof setTimeout> | null = null;

function getHost(): HTMLElement | null {
  return document.getElementById('fileViewerHostSecondary');
}

function destroySecondaryEditor(): void {
  if (lspTimer) {
    clearTimeout(lspTimer);
    lspTimer = null;
  }
  if (secondaryView) {
    secondaryView.destroy();
    secondaryView = null;
  }
  secondaryPath = null;
  const host = getHost();
  if (host) host.innerHTML = '';
}

/** Tear down secondary editor (split closed or slot cleared). */
export function destroySecondaryViewerSlot(): void {
  destroySecondaryEditor();
}

/** Mount editor for a workspace path in the secondary slot. */
export function renderSecondaryViewerSlot(tabPath: string | null): void {
  const host = getHost();
  if (!host || !tabPath) {
    destroySecondaryViewerSlot();
    return;
  }

  const tab = getViewerTab(tabPath);
  if (!tab || tab.loadStatus !== 'ready' || tab.viewMode !== 'editor') {
    host.textContent = tab?.loadStatus === 'loading' ? 'Loading…' : 'Open a file in this slot';
    destroySecondaryEditor();
    return;
  }

  const content = tab.cachedEditorContent ?? tab.originalContent;
  if (secondaryPath === tabPath && secondaryView) {
    const live = secondaryView.state.doc.toString();
    if (live !== content) {
      secondaryView.dispatch({
        changes: { from: 0, to: secondaryView.state.doc.length, insert: content },
      });
    }
    return;
  }

  destroySecondaryEditor();
  secondaryPath = tabPath;

  void (async () => {
    const editorSettings = await loadEditorSettings();
    const langExts = await loadLanguageExtensionsForPath(tabPath);
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(false),
        ...editorCoreExtensions({
          wordWrap: editorSettings.wordWrap,
          tabSize: editorSettings.tabSize,
          renderWhitespace: editorSettings.renderWhitespace,
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: `${editorSettings.fontSize}px` },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
        ...minnowEditorExtensions(),
        ...langExts,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || !secondaryPath) return;
          const text = update.state.doc.toString();
          const liveTab = getViewerTab(secondaryPath);
          if (!liveTab || liveTab.readOnlyExcerpt) return;
          const nextDirty = isViewerDocDirty(text, liveTab.originalContent);
          if (nextDirty !== liveTab.isDirty) {
            snapshotViewerTabEditorContent(secondaryPath, text, nextDirty);
          }
          if (lspTimer) clearTimeout(lspTimer);
          lspTimer = setTimeout(() => {
            void notifyLspDocument(secondaryPath!, 'change', text);
          }, 400);
        }),
      ],
    });
    if (!host.isConnected || secondaryPath !== tabPath) return;
    secondaryView = new EditorView({ state, parent: host });
    void notifyLspDocument(tabPath, 'open', content);
  })();
}
