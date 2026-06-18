/**
 * Sidebar per-chat status dot: idle, unread (green), user input required (yellow),
 * or reasoning phase (ring spinner). See resolveChatItemDotState for priority.
 */

import { streamingChatIds } from '../app-state';
import { getActiveChat, sessionState } from '../state/sessions';
import type { Chat } from '../types';

/** Ephemeral "last time user viewed this chat" for unread detection (not persisted). */
const chatLastOpenedAt = new Map<string, number>();

/** Per-chat stream phase for sidebar thinking dots (concurrent streams). */
const streamPhaseByChatId = new Map<string, 'generating' | 'thinking'>();

/** Active chat id while tool approval or ask_question UI is open. */
let inputPendingChatId: string | null = null;

export type ChatItemDotState = 'idle' | 'unread' | 'needs-input' | 'thinking';

export interface ChatItemDotContext {
  activeChatId: string | null;
  streamingChatIds: ReadonlySet<string>;
  streamPhaseByChatId: ReadonlyMap<string, 'generating' | 'thinking'>;
  inputPendingChatId: string | null;
}

/** Build context from app + module state (for sidebar render and DOM sync). */
export function getChatItemDotContext(activeChatId: string | null): ChatItemDotContext {
  return {
    activeChatId,
    streamingChatIds,
    streamPhaseByChatId,
    inputPendingChatId,
  };
}

/**
 * One resolved visual state per chat. Priority: needs-input > thinking > unread > idle.
 */
export function resolveChatItemDotState(chat: Chat, ctx: ChatItemDotContext): ChatItemDotState {
  if (ctx.inputPendingChatId != null && chat.id === ctx.inputPendingChatId) {
    return 'needs-input';
  }
  const streamingThisChat = ctx.streamingChatIds.has(chat.id);
  const phase = ctx.streamPhaseByChatId.get(chat.id);
  const inThinkingStream = streamingThisChat && phase === 'thinking';
  const generationThinkingReload =
    chat.id === ctx.activeChatId &&
    Boolean(chat.currentGenerationId?.trim()) &&
    phase === 'thinking';
  if (inThinkingStream || generationThinkingReload) {
    return 'thinking';
  }
  if (chat.id !== ctx.activeChatId && chat.unread === true) {
    return 'unread';
  }
  return 'idle';
}

/** Updates data-dot-state on the dot and optional row (for collapsed rail badge styling). */
export function applyChatItemDotClasses(
  dotEl: HTMLElement,
  state: ChatItemDotState,
  rowEl?: HTMLElement | null,
): void {
  dotEl.dataset.dotState = state;
  if (rowEl) rowEl.dataset.dotState = state;
  const existing = dotEl.querySelector('.chat-item-dot__spinner');
  if (state === 'thinking') {
    if (!existing) {
      const sp = document.createElement('span');
      sp.className = 'chat-item-dot__spinner';
      sp.setAttribute('aria-hidden', 'true');
      dotEl.appendChild(sp);
    }
  } else if (existing) {
    existing.remove();
  }
}

/** Refreshes every chat row dot without rebuilding the sidebar list. */
export function syncChatItemDotsInDom(): void {
  const state = sessionState;
  if (!state) return;
  const ctx = getChatItemDotContext(state.activeId);
  const list = document.getElementById('chatList');
  if (!list) return;
  for (const row of list.querySelectorAll<HTMLElement>('.chat-item-row[data-chat-id]')) {
    const id = row.dataset.chatId;
    if (!id) continue;
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) continue;
    const dot = row.querySelector('.chat-item-dot');
    if (!(dot instanceof HTMLElement)) continue;
    applyChatItemDotClasses(dot, resolveChatItemDotState(chat, ctx), row);
  }
}

/** Alias for call sites that already use this name from the plan. */
export const refreshSidebarChatDots = syncChatItemDotsInDom;

/** Read the last-known stream phase for sidebar dots / stream DOM remount. */
export function getSidebarStreamPhase(
  chatId: string,
): 'generating' | 'thinking' | null {
  return streamPhaseByChatId.get(chatId) ?? null;
}

/** Called when the model enters or leaves the reasoning SSE phase for a chat. */
export function setSidebarStreamPhase(
  phase: 'generating' | 'thinking' | null,
  chatId?: string,
): void {
  const id = chatId?.trim() || getActiveChat().id;
  if (!id) return;
  if (phase === null) {
    streamPhaseByChatId.delete(id);
  } else {
    streamPhaseByChatId.set(id, phase);
  }
  syncChatItemDotsInDom();
}

/**
 * Marks which chat is blocked on user input (tool approval or ask_question).
 * Pass null when the UI closes.
 */
export function setSidebarInputPendingChatId(chatId: string | null): void {
  inputPendingChatId = chatId;
  syncChatItemDotsInDom();
}

/** Convenience: mark pending for the active chat, or clear. */
export function setSidebarInputPendingForActiveChat(active: boolean): void {
  if (!active) {
    setSidebarInputPendingChatId(null);
    return;
  }
  setSidebarInputPendingChatId(getActiveChat().id);
}

/** Records that the user opened this chat (baseline for unread vs new assistant activity). */
export function recordChatOpened(chatId: string): void {
  chatLastOpenedAt.set(chatId, Date.now());
}

/** Boot: treat the initially active chat as "opened" so we do not mark unread incorrectly. */
export function bootstrapActiveChatOpenedTimestamp(): void {
  recordChatOpened(getActiveChat().id);
}

/**
 * If the assistant produced output after the user last viewed this chat, mark unread
 * (typically called when switching away from this chat).
 */
export function maybeMarkChatUnreadAfterLeave(chat: Chat): void {
  const openedAt = chatLastOpenedAt.get(chat.id) ?? 0;
  const lastAsst = chat.lastAssistantAt;
  if (lastAsst != null && Number.isFinite(lastAsst) && lastAsst > openedAt) {
    chat.unread = true;
  }
}

/** Updates the timestamp used when the user later leaves this chat (active stream only). */
export function recordAssistantReplyOnChat(chat: Chat): void {
  chat.lastAssistantAt = Date.now();
}
