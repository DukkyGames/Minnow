/**
 * Go to definition — F12 and Mod-click open the target in the file viewer.
 */

import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  fetchLspDefinition,
  type LspLocation,
} from '../../lsp/completion-client';
import { getWorkspacePath } from '../../state/workspace';
import { openFileInViewer } from '../file-viewer';
import { offsetToLspPosition } from './lsp-positions';

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function fileUriToRelativePath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    const abs = normalizeFsPath(pathname);
    const root = normalizeFsPath(getWorkspacePath());
    if (!root) return abs;
    const rootPrefix = `${root}/`;
    if (abs === root) return '';
    if (abs.startsWith(rootPrefix)) {
      return abs.slice(rootPrefix.length);
    }
    return abs;
  } catch {
    return null;
  }
}

function normalizeLocations(
  locations: LspLocation | LspLocation[] | null,
): LspLocation[] {
  if (locations == null) return [];
  return Array.isArray(locations) ? locations : [locations];
}

async function goToDefinitionAt(view: EditorView, filePath: string): Promise<boolean> {
  const head = view.state.selection.main.head;
  const lspPos = offsetToLspPosition(view, head);
  const raw = await fetchLspDefinition(filePath, lspPos.line, lspPos.character);
  const targets = normalizeLocations(raw);
  if (targets.length === 0) return false;

  const target = targets[0];
  const rel = fileUriToRelativePath(target.uri);
  if (!rel) return false;

  const line = target.range?.start?.line ?? 0;
  const character = target.range?.start?.character ?? 0;

  if (rel === filePath) {
    const doc = view.state.doc;
    const lineNumber = Math.min(line + 1, doc.lines);
    const lineInfo = doc.line(lineNumber);
    const col = Math.min(character, lineInfo.length);
    const anchor = lineInfo.from + col;
    view.dispatch({
      selection: EditorSelection.cursor(anchor),
      effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
    });
    view.focus();
    return true;
  }

  await openFileInViewer(rel, {
    skipUnsavedGuard: false,
    initialSelection: { line, character },
  });
  return true;
}

/** Definition navigation: F12 and Mod-click. */
export function lspDefinitionExtensions(filePath: string): Extension[] {
  const definitionKeymap = keymap.of([
    {
      key: 'F12',
      run: (view) => {
        void goToDefinitionAt(view, filePath);
        return true;
      },
    },
  ]);

  const modClick = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey && !event.ctrlKey) return false;
      if (event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      view.dispatch({ selection: { anchor: pos } });
      void goToDefinitionAt(view, filePath);
      event.preventDefault();
      return true;
    },
  });

  return [Prec.high(definitionKeymap), modClick];
}
