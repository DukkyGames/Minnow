/**
 * Read-only file viewer (CodeMirror 6) using read_file / read_file_range tools.
 */

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { executeTool } from '../tools/client';
import { patchFilePanelState } from '../state/file-panel';
import {
  hideViewerSplit,
  showViewerSplit,
} from './file-layout';
import { renderFileTree } from './file-tree';

const LARGE_FILE_BYTES = 512_000;
const RANGE_LINE_COUNT = 2000;

let editorView: EditorView | null = null;
let currentPath: string | null = null;

/** Strip "N: " prefixes from read_file_range output. */
export function parseReadFileRangeBody(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\d+:\s?/, ''))
    .join('\n');
}

async function loadLanguageExtension(path: string): Promise<Extension[]> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  try {
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'mts':
        return [(await import('@codemirror/lang-javascript')).javascript({ typescript: true })];
      case 'js':
      case 'mjs':
      case 'cjs':
        return [(await import('@codemirror/lang-javascript')).javascript()];
      case 'json':
        return [(await import('@codemirror/lang-json')).json()];
      case 'md':
      case 'markdown':
        return [(await import('@codemirror/lang-markdown')).markdown()];
      case 'css':
        return [(await import('@codemirror/lang-css')).css()];
      case 'html':
      case 'htm':
        return [(await import('@codemirror/lang-html')).html()];
      case 'py':
        return [(await import('@codemirror/lang-python')).python()];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

function getViewerHost(): HTMLElement | null {
  return document.getElementById('fileViewerHost');
}

function getPathLabel(): HTMLElement | null {
  return document.getElementById('fileViewerPath');
}

function destroyEditor(): void {
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
}

function mountEditor(content: string, path: string): void {
  const host = getViewerHost();
  if (!host) return;
  destroyEditor();
  host.innerHTML = '';

  void loadLanguageExtension(path).then((langExts) => {
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
        ...langExts,
      ],
    });
    editorView = new EditorView({ state, parent: host });
  });
}

export function setViewerLoading(path: string): void {
  const label = getPathLabel();
  if (label) label.textContent = path;
  const host = getViewerHost();
  if (host) {
    destroyEditor();
    host.innerHTML = '<p class="file-viewer-status">Loading…</p>';
  }
}

export function setViewerError(message: string): void {
  const host = getViewerHost();
  if (host) {
    destroyEditor();
    host.innerHTML = `<p class="file-viewer-status file-viewer-error">${escapeHtml(message)}</p>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function loadFileContent(path: string): Promise<string> {
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
    return (
      body +
      `\n\n/* Showing lines 1–${RANGE_LINE_COUNT} only (${raw.length} bytes total). */`
    );
  }

  return raw;
}

/** Open a project file in the split viewer. */
export async function openFileInViewer(relativePath: string): Promise<void> {
  currentPath = relativePath;
  patchFilePanelState({ selectedPath: relativePath });
  showViewerSplit();
  setViewerLoading(relativePath);
  renderFileTree();

  try {
    const content = await loadFileContent(relativePath);
    mountEditor(content, relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setViewerError(message || 'Could not open file');
  }
}

/** Close viewer pane and clear selection. */
export function closeFileViewer(): void {
  currentPath = null;
  patchFilePanelState({ selectedPath: null });
  destroyEditor();
  const host = getViewerHost();
  if (host) host.innerHTML = '';
  const label = getPathLabel();
  if (label) label.textContent = '';
  hideViewerSplit();
  renderFileTree();
}

export function getOpenViewerPath(): string | null {
  return currentPath;
}
