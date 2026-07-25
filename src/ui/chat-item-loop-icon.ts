/**
 * Sidebar per-chat /loop indicator: masked loop.svg; spins while at least one loop is unpaused.
 */

import { getActiveLoops, sessionState } from '../state/sessions';
import type { Chat } from '../types';

export const CHAT_ITEM_LOOP_ICON_SRC = '/icons/loop.svg';

export type ChatItemLoopIconState = 'hidden' | 'running' | 'paused';

/** Whether the chat row should show a loop glyph (any persisted activeLoops). */
export function resolveChatItemLoopIconState(chat: Chat): ChatItemLoopIconState {
  const loops = getActiveLoops(chat);
  if (!loops.length) return 'hidden';
  return loops.some((loop) => !loop.paused) ? 'running' : 'paused';
}

function loopIconTitle(chat: Chat): string {
  const loops = getActiveLoops(chat);
  const running = loops.filter((loop) => !loop.paused).length;
  const paused = loops.length - running;
  const parts: string[] = [];
  if (running > 0) {
    parts.push(`${running} loop${running === 1 ? '' : 's'} running`);
  }
  if (paused > 0) {
    parts.push(`${paused} paused`);
  }
  return parts.join(', ') || 'Loop active';
}

/** Create the masked loop icon span for a chat title row. */
export function createChatItemLoopIcon(): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'chat-item-loop-icon';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Apply visibility, spin state, and tooltip for one loop icon element. */
export function applyChatItemLoopIcon(
  el: HTMLElement,
  state: ChatItemLoopIconState,
  chat?: Chat,
): void {
  el.dataset.loopState = state;
  el.hidden = state === 'hidden';
  if (state === 'hidden' || !chat) {
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
    return;
  }
  const title = loopIconTitle(chat);
  el.title = title;
  el.setAttribute('aria-label', title);
}

/** Refresh loop icons on every sidebar / rail chat row without rebuilding the list. */
export function syncChatItemLoopIconsInDom(): void {
  const state = sessionState;
  if (!state) return;

  for (const row of document.querySelectorAll<HTMLElement>('.chat-item-row[data-chat-id]')) {
    const id = row.dataset.chatId;
    if (!id) continue;
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) continue;

    const loopState = resolveChatItemLoopIconState(chat);
    let icon = row.querySelector<HTMLElement>('.chat-item-loop-icon');
    if (!icon && loopState !== 'hidden') {
      icon = createChatItemLoopIcon();
      const titleRow = row.querySelector('.chat-item-title-row');
      const agentBadge = titleRow?.querySelector('.chat-item-agent-badge');
      if (titleRow) {
        if (agentBadge) {
          titleRow.insertBefore(icon, agentBadge);
        } else {
          titleRow.appendChild(icon);
        }
      } else {
        row.appendChild(icon);
      }
    }
    if (!(icon instanceof HTMLElement)) continue;
    applyChatItemLoopIcon(icon, loopState, chat);
  }
}
