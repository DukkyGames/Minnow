/**
 * Ambient context for quick capture.
 *
 * The menubar button's job is that you never type where a problem is. It reads
 * whatever the shell was already showing — active file and selection, the chat
 * you were in, the branch and HEAD you are on — and pre-attaches it.
 *
 * Everything here is best-effort and defensive: capture must open instantly and
 * must never fail because git is slow or a module is not mounted. Synchronous
 * context comes back from {@link collectAmbientCapture}; git resolves later via
 * {@link collectGitCapture} and is merged in when it lands.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

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
    // Imported lazily-by-reference: the module graph already loads these in the
    // shell, and a static import here would pull the editor into every entry.
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

/**
 * Resolved once and cached. Kept behind a function so tests can run without the
 * editor bundle and so a missing module degrades to "no file context" rather
 * than an exception during capture.
 */
let viewerModule: ViewerModule | null | undefined;
let editorViewGetter: (() => unknown) | null | undefined;

function codeViewerModule(): ViewerModule | null {
  return viewerModule ?? null;
}

/**
 * Wire the editor accessors from the shell after boot.
 *
 * Capture must not import the editor: it lives in the menubar, which mounts
 * before Code ever opens. The shell hands the accessors over once, and capture
 * degrades to "no file context" until then.
 */
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
  // No `detail`: the chat id is a UUID, and eleven pixels of truncated UUID on
  // a chip is noise. It stays on the chip's title attribute instead.
  return {
    kind: 'chat',
    label: title && title !== 'New chat' ? title : 'Current chat',
    chatId: id,
  };
}

/**
 * Synchronous ambient context. Safe to call on every popover open.
 *
 * `workspacePath` is read through the accessor rather than imported so this
 * module stays free of state imports that would drag the store into the
 * menubar's load path.
 */
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

/**
 * Branch and HEAD, resolved off the main path.
 *
 * Deliberately not awaited before the popover paints: capture opens in one
 * frame and the git chips arrive when they arrive. A repo-less workspace or a
 * server that is not up simply yields nothing.
 */
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
    // No repo, no server, or git is busy. Capture works without it.
  }
  return items;
}

/** Reset cached accessors (tests). */
export function resetCaptureContextForTests(): void {
  viewerModule = undefined;
  editorViewGetter = undefined;
  chatAccessor = null;
}
