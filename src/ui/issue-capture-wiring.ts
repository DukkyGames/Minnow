/**
 * Hands the editor and chat accessors to capture at boot.
 *
 * `issue-capture-context.ts` deliberately imports neither the editor nor the
 * session store: it runs from the menubar, which mounts long before Code opens,
 * and a static import there would pull CodeMirror into the shell's first paint.
 * This file is the one place that knows about both sides, and it is loaded on
 * the boot path where those modules are already resolved.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import {
  registerCaptureChatAccessor,
  registerCaptureEditorAccessors,
} from './issue-capture-context';
import { registerCaptureChatTitleLookup } from './capture-drag';

let wired = false;

/** Wire capture's ambient-context accessors. Safe to call more than once. */
export function wireCaptureAccessors(): void {
  if (wired) return;
  wired = true;

  registerCaptureEditorAccessors({
    getActiveViewerTabPath: () => {
      try {
        // Resolved through the module cache; the shell has already loaded it by
        // the time a capture can be opened over an editor.
        return viewerTabStore?.getActiveViewerTabPath() ?? null;
      } catch {
        return null;
      }
    },
    getEditorView: () => {
      try {
        return fileViewer?.getFileViewerEditorView() ?? null;
      } catch {
        return null;
      }
    },
  });

  registerCaptureChatAccessor(() => {
    try {
      const chat = sessions?.getActiveChat();
      return chat ? { id: chat.id, title: chat.name } : null;
    } catch {
      return null;
    }
  });

  void import('./file-viewer-tab-store').then((m) => {
    viewerTabStore = m;
  });
  void import('./file-viewer').then((m) => {
    fileViewer = m;
  });
  void import('../state/sessions').then((m) => {
    sessions = m;
    registerCaptureChatTitleLookup((chatId) => {
      const chat = m.sessionState?.chats.find((entry) => entry.id === chatId);
      return chat?.name?.trim() ?? null;
    });
  });
}

let viewerTabStore: typeof import('./file-viewer-tab-store') | null = null;
let fileViewer: typeof import('./file-viewer') | null = null;
let sessions: typeof import('../state/sessions') | null = null;

/** Reset module state (tests). */
export function resetCaptureWiringForTests(): void {
  wired = false;
  viewerTabStore = null;
  fileViewer = null;
  sessions = null;
}
