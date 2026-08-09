/**
 * Persist unsent composer text on the active chat as a sidebar draft row.
 */

import {
  getActiveChat,
  getChatMessageCount,
  isEphemeralEmptyChat,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import {
  hasComposerDraft,
} from '../state/session-workspace-scope';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat } from '../types';
import { clearComposerInput, getActiveComposerSurface } from './composer-surface';
import { autoResize } from './input';

let draftRestoreSuspended = false;

/** Debounce draft-only sidebar title tweaks (full rebuild only when list membership changes). */
let draftSidebarLabelTimer: ReturnType<typeof setTimeout> | null = null;
const DRAFT_SIDEBAR_LABEL_DEBOUNCE_MS = 200;

function scheduleComposerDraftSidebarLabelSync(chat: Chat): void {
  if (getChatMessageCount(chat) !== 0 || !hasComposerDraft(chat)) return;
  if (draftSidebarLabelTimer) clearTimeout(draftSidebarLabelTimer);
  draftSidebarLabelTimer = setTimeout(() => {
    draftSidebarLabelTimer = null;
    void import('./sidebar').then((m) => m.syncComposerDraftSidebarLabels(chat));
  }, DRAFT_SIDEBAR_LABEL_DEBOUNCE_MS);
}

/** True while programmatically restoring draft text into the composer. */
export function isComposerDraftRestoreSuspended(): boolean {
  return draftRestoreSuspended;
}

/** Write unsent composer text onto a chat row (clears when empty). */
export function persistComposerDraftOnChat(chat: Chat, rawText: string): boolean {
  const trimmed = rawText.trim();
  const hadDraft = hasComposerDraft(chat);
  if (trimmed) {
    chat.composerDraft = rawText;
  } else {
    delete chat.composerDraft;
  }
  return hadDraft !== hasComposerDraft(chat);
}

/** Remove persisted draft text after a user message is committed. */
export function clearComposerDraftOnChat(chat: Chat): void {
  delete chat.composerDraft;
}

/** Clear textarea and persisted draft after text is committed (send, queue, or slash command). */
export function clearComposerAfterSend(
  chat: Chat,
  inputEl?: HTMLTextAreaElement | null,
): void {
  const hadDraft = hasComposerDraft(chat);
  clearComposerDraftOnChat(chat);
  clearComposerInput(inputEl ?? getActiveComposerSurface().inputEl);
  if (!hadDraft) return;
  scheduleSaveSessions({ chatId: chat.id });
  void import('./sidebar').then((m) => m.renderSidebar());
  void import('./chat-app').then((m) => m.refreshChatAppSessionRail());
  void import('./desktop-chat-rail').then((m) => m.refreshDesktopChatRail());
}

/** Snapshot the active composer into a chat before leaving it. */
export function persistComposerDraftForChatId(chatId: string): boolean {
  if (!sessionState) return false;
  const chat = sessionState.chats.find((c) => c.id === chatId);
  if (!chat) return false;
  const text = getActiveComposerSurface().inputEl?.value ?? '';
  return persistComposerDraftOnChat(chat, text);
}

/** Load a chat's draft into the active composer (or clear when none). */
export function applyComposerDraftForChat(chat: Chat): void {
  const input = getActiveComposerSurface().inputEl;
  if (!input) return;
  draftRestoreSuspended = true;
  input.value = chat.composerDraft ?? '';
  if (input.id === 'desktopInput') {
    void import('../os/desktop-composer-resize').then((m) =>
      m.autoResizeDesktopComposer(input),
    );
  } else {
    autoResize(input);
  }
  draftRestoreSuspended = false;
}

/** Track draft edits on the active chat and refresh sidebar when visibility changes. */
export function handleComposerDraftInput(): void {
  const active = sessionState;
  if (draftRestoreSuspended || !active?.activeId) return;
  const chat = active.chats.find((c) => c.id === active.activeId);
  if (!chat) return;

  const text = getActiveComposerSurface().inputEl?.value ?? '';
  const visibilityChanged = persistComposerDraftOnChat(chat, text);
  if (!visibilityChanged && !hasComposerDraft(chat)) return;

  scheduleSaveSessions({ chatId: chat.id });

  // Rebuilding the sidebar on every keystroke made typing feel stuck once a draft
  // existed (`hasComposerDraft` stayed true). Full rebuild only when a row appears
  // or disappears; draft-only titles get a cheap debounced label sync.
  if (visibilityChanged) {
    void import('./sidebar').then((m) => m.renderSidebar());
    void import('./chat-app').then((m) => m.refreshChatAppSessionRail());
    void import('./desktop-chat-rail').then((m) => m.refreshDesktopChatRail());
  } else {
    scheduleComposerDraftSidebarLabelSync(chat);
  }
}

/** Wire draft persistence for one composer textarea. */
export function initComposerDraftListener(inputEl?: HTMLTextAreaElement | null): void {
  const input = inputEl ?? getActiveComposerSurface().inputEl;
  if (!input || input.dataset.draftListener === '1') return;
  input.dataset.draftListener = '1';
  input.addEventListener('input', () => {
    handleComposerDraftInput();
  });
}

/** Flush the active composer, then clear it for a fresh ephemeral chat. */
export function flushActiveComposerDraftBeforeNewChat(): void {
  if (sessionState?.activeId) {
    persistComposerDraftForChatId(sessionState.activeId);
  }
  clearComposerInput(getActiveComposerSurface().inputEl);
}

/** When reusing the current ephemeral chat, just clear the composer. */
export function resetComposerForEphemeralReuse(): void {
  clearComposerInput(getActiveComposerSurface().inputEl);
}

/** Persist leaving chat draft, then restore the target chat draft. */
export function switchComposerDraft(prevChatId: string | null | undefined, nextChat: Chat): void {
  if (prevChatId && prevChatId !== nextChat.id) {
    persistComposerDraftForChatId(prevChatId);
  }
  applyComposerDraftForChat(nextChat);
}

/** True when the active chat can be reused instead of creating another empty row. */
export function canReuseActiveEphemeralChat(workspacePath: string): boolean {
  try {
    const chat = getActiveChat();
    return (
      isEphemeralEmptyChat(chat) &&
      normalizeWorkspacePath(chat.workspacePath ?? '') === normalizeWorkspacePath(workspacePath)
    );
  } catch {
    return false;
  }
}
