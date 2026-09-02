import { formatCodeRefLabel } from '../attachments/code-ref-format';
import {
  emptyCapturePayload,
  type CaptureItem,
  type CapturePayload,
} from '../issues/capture-payload';

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Active editor tab plus its selection, when the editor is mounted. */
function activeFileItem(): CaptureItem | null {
  const path = safe(() => {
    const store = codeViewerModule();
    return store?.getActiveViewerTabPath() ?? null;
  });
  if (!path) return null;

  const selection = safe(() => readEditorSelection());
  if (selection) {
    return {
      kind: 'code',
      label: formatCodeRefLabel(path, selection.startLine, selection.endLine),
      detail: 'Editor selection',
      codeRef: {
        path,
        startLine: selection.startLine,
        endLine: selection.endLine,
        snippet: selection.text.slice(0, 2000),
      },
      text: selection.text,
    };
  }

  return {
    kind: 'file',
    label: basename(path),
    detail: path,
    codeRef: { path },
  };
}

type ViewerModule = {
  getActiveViewerTabPath: () => string | null;
};

/** Resolved once and cached. */
let viewerModule: ViewerModule | null | undefined;
let editorViewGetter: (() => unknown) | null | undefined;

function codeViewerModule(): ViewerModule | null {
  return viewerModule ?? null;
}

/** Wire the editor accessors from the shell after boot. */
export function registerCaptureEditorAccessors(accessors: {
  getActiveViewerTabPath: () => string | null;
  getEditorView: () => unknown;
}): void {
  viewerModule = { getActiveViewerTabPath: accessors.getActiveViewerTabPath };
  editorViewGetter = accessors.getEditorView;
}

interface EditorSelection {
  startLine: number;
  endLine: number;
  text: string;
}

/** Duck-typed CodeMirror read: no `instanceof`, which throws across realms. */
function readEditorSelection(): EditorSelection | null {
  const view = editorViewGetter?.() as
    | {
        state?: {
          selection?: { main?: { from?: number; to?: number } };
          doc?: {
            lineAt: (pos: number) => { number: number };
            sliceString: (from: number, to: number) => string;
          };
        };
      }
    | null
    | undefined;

  const main = view?.state?.selection?.main;
  const doc = view?.state?.doc;
  if (!main || !doc || typeof main.from !== 'number' || typeof main.to !== 'number') return null;
  if (main.to <= main.from) return null;

  const text = doc.sliceString(main.from, main.to);
  if (!text.trim()) return null;
  return {
    startLine: doc.lineAt(main.from).number,
    endLine: doc.lineAt(main.to).number,
    text,
  };
}

type ChatAccessor = () => { id?: string; title?: string } | null;
let chatAccessor: ChatAccessor | null = null;

/** Wire the active-chat accessor from the shell (same reason as the editor). */
export function registerCaptureChatAccessor(accessor: ChatAccessor): void {
  chatAccessor = accessor;
}

function activeChatItem(): CaptureItem | null {
  const chat = safe(() => chatAccessor?.() ?? null);
  const id = chat?.id?.trim();
  if (!id) return null;
  const title = chat?.title?.trim();
  return {
    kind: 'chat',
    label: title && title !== 'New chat' ? title : 'Current chat',
    chatId: id,
  };
}

/** Synchronous ambient context. */
export function collectAmbientCapture(workspacePath?: string): CapturePayload {
  const payload = emptyCapturePayload();
  payload.sourceLabel = 'Quick capture';
  if (workspacePath) payload.workspacePath = workspacePath;

  const file = activeFileItem();
  if (file) payload.items.push(file);

  const chat = activeChatItem();
  if (chat) payload.items.push(chat);

  return payload;
}

/** Branch and HEAD, resolved off the main path. */
export async function collectGitCapture(): Promise<CaptureItem[]> {
  const items: CaptureItem[] = [];
  try {
    const api = await import('../state/git-api');
    const status = await api.gitStatus();
    const branch = status.ok ? status.branch?.trim() : '';
    if (branch) {
      items.push({
        kind: 'git',
        label: branch,
        detail: 'branch',
        gitLink: { kind: 'branch', ref: branch },
      });
    }

    const log = await api.gitLog({ count: 1 });
    const head = log.ok ? log.commits?.[0] : undefined;
    if (head?.hash) {
      items.push({
        kind: 'git',
        label: head.hash.slice(0, 8),
        detail: head.subject?.trim() || 'HEAD',
        gitLink: {
          kind: 'commit',
          ref: head.hash,
          title: head.subject?.trim() || undefined,
        },
      });
    }
  } catch {
  }
  return items;
}

/** Reset cached accessors (tests). */
export function resetCaptureContextForTests(): void {
  viewerModule = undefined;
  editorViewGetter = undefined;
  chatAccessor = null;
}
