/**
 * Desktop session rail — assistant sandbox chats on the OS desktop.
 */

import { getChatsWorkspacePath } from '../lib/chats-workspace';
import { getAssistantChats, sessionState } from '../state/sessions';
import { appendChatRow } from './sidebar';
import { syncChatItemDotsInDom } from './chat-item-dot';

let railExpanded = false;

function getRailRoot(): HTMLElement | null {
  return document.querySelector('.mn-os-chat-rail');
}

function getRailList(): HTMLElement | null {
  return document.getElementById('desktopChatSessionList');
}

function syncRailClasses(): void {
  const rail = getRailRoot();
  if (!rail) return;
  rail.classList.toggle('is-expanded', railExpanded);
  rail.classList.toggle('is-collapsed', !railExpanded);
}

/** Toggle expanded (240px) vs collapsed (left tab) rail. */
export function toggleDesktopChatRail(): void {
  railExpanded = !railExpanded;
  syncRailClasses();
}

/** Whether the rail list is expanded. */
export function isDesktopChatRailExpanded(): boolean {
  return railExpanded;
}

/** Paint session rows for the chats workspace sandbox. */
export function renderDesktopChatRail(chatsWorkspacePath?: string | null): void {
  const list = getRailList();
  if (!list || !sessionState) return;
  list.replaceChildren();

  const path = chatsWorkspacePath ?? null;
  if (!path) return;

  const chats = getAssistantChats(path, sessionState);
  const activeId = sessionState.activeId;
  for (const chat of chats) {
    appendChatRow(list, chat, activeId, {
      draggable: false,
      onActivate: (item) => {
        void import('../os/desktop-chat').then((m) => m.activateDesktopChatSession(item.id));
      },
    });
  }
  syncChatItemDotsInDom();
  syncRailClasses();
}

/** Wire rail tab toggle (call once from desktop render). */
export function wireDesktopChatRail(): void {
  const tab = document.getElementById('btnDesktopChatRailToggle');
  if (!tab || tab.dataset.bound === '1') return;
  tab.dataset.bound = '1';
  tab.addEventListener('click', () => toggleDesktopChatRail());
}

/** Ensure workspace path is loaded before first rail paint. */
export async function refreshDesktopChatRail(): Promise<void> {
  const path = await getChatsWorkspacePath();
  renderDesktopChatRail(path);
}

/** Reset rail UI state (tests). */
export function resetDesktopChatRailForTests(): void {
  railExpanded = false;
  syncRailClasses();
}
