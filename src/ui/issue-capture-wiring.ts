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
