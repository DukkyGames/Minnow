/**
 * Desktop session rail — assistant sandbox chats on the OS desktop.
 */

import { getChatsWorkspacePath } from '../lib/chats-workspace';
import { createAssistantChat, CHAT_APP_ID } from '../state/chat-app-sessions';
import {
  getAssistantChats,
  newChatId,
  rememberActiveChatForApp,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import {
  getExpertScopeId,
  isExpertScopeActive,
  renderExpertScopeChatList,
  renderExpertScopeHeader,
} from './experts/experts-scope';
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

  const tab = document.getElementById('btnDesktopChatRailToggle');
  if (tab) {
    tab.setAttribute('aria-expanded', railExpanded ? 'true' : 'false');
    tab.setAttribute('aria-label', railExpanded ? 'Hide chat sessions' : 'Show chat sessions');
  }
}

/** Expand the session rail (left-edge tab). */
export function expandDesktopChatRail(): void {
  if (railExpanded) return;
  railExpanded = true;
  syncRailClasses();
}

/** Collapse the session rail back to the left-edge tab. */
export function collapseDesktopChatRail(): void {
  if (!railExpanded) return;
  railExpanded = false;
  syncRailClasses();
}

/** Toggle expanded vs collapsed rail. */
export function toggleDesktopChatRail(): void {
  railExpanded = !railExpanded;
  syncRailClasses();
}

/** Whether the rail list is expanded. */
export function isDesktopChatRailExpanded(): boolean {
  return railExpanded;
}

function getRailMain(): HTMLElement | null {
  return document.querySelector('.mn-os-chat-rail-main');
}

function getExpertScopeChrome(): HTMLElement | null {
  return document.getElementById('expertScopeChrome');
}

function getLegacySidebar(): HTMLElement | null {
  return document.getElementById('chatSidebar');
}

/** Reparent expert scope chrome into the desktop rail (or restore to legacy sidebar). */
function mountExpertScopeInRail(active: boolean): void {
  const scope = getExpertScopeChrome();
  const railPanel = document.querySelector('.mn-os-chat-rail-panel');
  const railMain = getRailMain();
  const sidebar = getLegacySidebar();
  if (!scope || !railPanel || !railMain || !sidebar) return;

  if (active) {
    railMain.hidden = true;
    scope.hidden = false;
    scope.classList.remove('hidden');
    if (scope.parentElement !== railPanel) {
      railPanel.appendChild(scope);
    }
    return;
  }

  railMain.hidden = false;
  scope.hidden = true;
  scope.classList.add('hidden');
  if (scope.parentElement !== sidebar) {
    sidebar.insertBefore(scope, sidebar.firstChild);
  }
}

/** Paint expert-scoped chat rows in the desktop session rail. */
export function renderDesktopExpertScopeRail(
  expertId: string,
  activeChatId: string,
): void {
  mountExpertScopeInRail(true);
  renderExpertScopeHeader(expertId);
  renderExpertScopeChatList(expertId, activeChatId);
  syncRailClasses();
}

/** Restore the desktop rail to assistant sandbox sessions. */
export function clearDesktopExpertScopeRail(): void {
  mountExpertScopeInRail(false);
  void refreshDesktopChatRail();
}

/** Create a new assistant chat on the desktop surface. */
export async function createNewDesktopChat(): Promise<void> {
  const path = await getChatsWorkspacePath();
  if (!path || !sessionState) return;

  const chat = createAssistantChat(path, newChatId());
  sessionState.chats.unshift(chat);
  sessionState.activeId = chat.id;
  rememberActiveChatForApp(CHAT_APP_ID, chat.id);
  scheduleSaveSessions();

  const desktopChat = await import('../os/desktop-chat');
  desktopChat.activateDesktopChatSession(chat.id);
  renderDesktopChatRail(path);

  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  input?.focus();
}

/** Paint session rows for the chats workspace sandbox. */
export function renderDesktopChatRail(chatsWorkspacePath?: string | null): void {
  const list = getRailList();
  if (!list || !sessionState) return;

  if (isExpertScopeActive()) {
    const expertId = getExpertScopeId();
    if (expertId) {
      renderDesktopExpertScopeRail(expertId, sessionState.activeId);
    }
    return;
  }

  mountExpertScopeInRail(false);
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

/** Wire rail controls (call once from desktop render). */
export function wireDesktopChatRail(): void {
  const tab = document.getElementById('btnDesktopChatRailToggle');
  if (tab && tab.dataset.bound !== '1') {
    tab.dataset.bound = '1';
    tab.addEventListener('click', () => expandDesktopChatRail());
  }

  const collapse = document.getElementById('btnDesktopChatRailCollapse');
  if (collapse && collapse.dataset.bound !== '1') {
    collapse.dataset.bound = '1';
    collapse.addEventListener('click', () => collapseDesktopChatRail());
  }

  const newChat = document.getElementById('btnDesktopChatNew');
  if (newChat && newChat.dataset.bound !== '1') {
    newChat.dataset.bound = '1';
    newChat.addEventListener('click', () => {
      void createNewDesktopChat();
    });
  }
}

/** Ensure workspace path is loaded before first rail paint. */
export async function refreshDesktopChatRail(): Promise<void> {
  const path = await getChatsWorkspacePath();
  renderDesktopChatRail(path);
}

/** Reset rail UI state (tests). */
export function resetDesktopChatRailForTests(): void {
  railExpanded = false;
  mountExpertScopeInRail(false);
  syncRailClasses();
}
