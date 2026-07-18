/**
 * Desktop session rail — assistant sandbox chats on the OS desktop.
 */

import { getDesktopWorkspacePath } from '../lib/desktop-workspace';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { DESKTOP_APP_ID, createDesktopChat } from '../state/session-workspace-scope';
import {
  getActiveChat,
  getAssistantChats,
  isEphemeralEmptyChat,
  newChatId,
  pruneEphemeralEmptyChats,
  rememberActiveChatForApp,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import {
  getChatLastMessageAt,
  isSidebarListedChat,
} from '../state/session-workspace-scope';
import {
  flushActiveComposerDraftBeforeNewChat,
  resetComposerForEphemeralReuse,
} from './composer-draft';
import {
  getExpertScopeId,
  isExpertScopeActive,
  renderExpertScopeChatList,
  renderExpertScopeHeader,
} from './experts/experts-scope';
import { appendChatRow } from './sidebar';
import { syncChatItemDotsInDom } from './chat-item-dot';
import type { Chat } from '../types';

const MOBILE_DESKTOP_MQ = '(max-width: 640px)';

let railExpanded = false;
let mobileMq: MediaQueryList | null = null;
let mobileMqListener: ((event: MediaQueryListEvent) => void) | null = null;

function isMobileDesktopLayout(): boolean {
  return window.matchMedia(MOBILE_DESKTOP_MQ).matches;
}

function getRailBackdrop(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.mn-os-chat-rail-backdrop');
}

function syncRailBackdrop(): void {
  const backdrop = getRailBackdrop();
  if (!backdrop) return;
  const show = isMobileDesktopLayout() && railExpanded;
  backdrop.classList.toggle('is-open', show);
  backdrop.setAttribute('aria-hidden', show ? 'false' : 'true');
  backdrop.tabIndex = show ? 0 : -1;
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

  syncRailBackdrop();
}

/** Expand the session rail (left-edge tab). */
export function expandDesktopChatRail(): void {
  if (railExpanded) return;
  railExpanded = true;
  syncRailClasses();
  void refreshDesktopChatRail();
}

/** Collapse the session rail back to the left-edge tab. */
export function collapseDesktopChatRail(): void {
  if (!railExpanded) return;
  railExpanded = false;
  syncRailClasses();
}

function maybeCollapseRailOnMobile(): void {
  if (isMobileDesktopLayout()) {
    collapseDesktopChatRail();
  }
}

function getRailRoot(): HTMLElement | null {
  return document.querySelector('.mn-os-chat-rail');
}

function getRailList(): HTMLElement | null {
  return document.getElementById('desktopChatSessionList');
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
  const path = await getDesktopWorkspacePath();
  if (!path || !sessionState) return;

  flushActiveComposerDraftBeforeNewChat();
  try {
    const active = getActiveChat();
    if (
      isEphemeralEmptyChat(active) &&
      normalizeWorkspacePath(active.workspacePath ?? '') === normalizeWorkspacePath(path)
    ) {
      resetComposerForEphemeralReuse();
      const { isDesktopChatActive, activateDesktopChat } = await import('../os/desktop-state');
      if (!isDesktopChatActive()) {
        await activateDesktopChat({ chatId: active.id });
        return;
      }
      const desktopChat = await import('../os/desktop-chat');
      desktopChat.activateDesktopChatSession(active.id);
      renderDesktopChatRail(path);
      return;
    }
  } catch {
    /* no active chat */
  }

  const chat = createDesktopChat(path, newChatId());
  const prevId = sessionState.activeId;
  sessionState.chats.unshift(chat);
  pruneEphemeralEmptyChats(sessionState, chat.id);
  sessionState.activeId = chat.id;
  rememberActiveChatForApp(DESKTOP_APP_ID, chat.id);
  scheduleSaveSessions();

  const { isDesktopChatActive, activateDesktopChat } = await import('../os/desktop-state');
  const desktopChat = await import('../os/desktop-chat');
  desktopChat.syncDesktopChatSessionSwitch(prevId, chat);
  if (!isDesktopChatActive()) {
    await activateDesktopChat({ chatId: chat.id });
    return;
  }

  desktopChat.activateDesktopChatSession(chat.id);
  resetComposerForEphemeralReuse();
  renderDesktopChatRail(path);

  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  input?.focus();
}

/** Chats shown in the desktop session rail (sandbox assistants + expert threads). */
function getDesktopRailChats(
  desktopWorkspacePath: string,
  state: NonNullable<typeof sessionState>,
): Chat[] {
  const assistant = getAssistantChats(desktopWorkspacePath, state);
  const experts = state.chats.filter(
    (c) => c.kind === 'expert' && isSidebarListedChat(c),
  );
  const seen = new Set<string>();
  const merged: Chat[] = [];
  for (const chat of [...assistant, ...experts]) {
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    merged.push(chat);
  }
  merged.sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
  return merged;
}

/** Paint session rows for the desktop workspace sandbox. */
export function renderDesktopChatRail(desktopWorkspacePath?: string | null): void {
  const list = getRailList();
  if (!list || !sessionState) return;

  mountExpertScopeInRail(false);
  list.replaceChildren();

  const path = desktopWorkspacePath ?? null;
  if (!path) return;

  const chats = getDesktopRailChats(path, sessionState);
  const activeId = sessionState.activeId;
  for (const chat of chats) {
    appendChatRow(list, chat, activeId, {
      draggable: false,
      onActivate: (item) => {
        void (async () => {
          const { isDesktopChatActive, activateDesktopChat } = await import('../os/desktop-state');
          if (!isDesktopChatActive()) {
            await activateDesktopChat({ chatId: item.id });
            maybeCollapseRailOnMobile();
            return;
          }
          const desktopChat = await import('../os/desktop-chat');
          desktopChat.activateDesktopChatSession(item.id);
          maybeCollapseRailOnMobile();
        })();
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

  const search = document.getElementById('btnDesktopChatSearch');
  if (search && search.dataset.bound !== '1') {
    search.dataset.bound = '1';
    search.addEventListener('click', () => {
      void import('./chat-search-popover').then((m) => m.toggleChatSearchPopover(search));
    });
  }

  const backdrop = getRailBackdrop();
  if (backdrop && backdrop.dataset.bound !== '1') {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', () => collapseDesktopChatRail());
  }

  if (!mobileMq && typeof window.matchMedia === 'function') {
    mobileMq = window.matchMedia(MOBILE_DESKTOP_MQ);
    mobileMqListener = () => {
      if (!isMobileDesktopLayout()) {
        syncRailBackdrop();
        return;
      }
      if (railExpanded) syncRailBackdrop();
    };
    mobileMq.addEventListener('change', mobileMqListener);
  }

  const newChat = document.getElementById('btnDesktopChatNew');
  if (newChat && newChat.dataset.bound !== '1') {
    newChat.dataset.bound = '1';
    newChat.addEventListener('click', () => {
      void createNewDesktopChat();
    });
  }

  void refreshDesktopChatRail();
}

/** Ensure workspace path is loaded before first rail paint. */
export async function refreshDesktopChatRail(): Promise<void> {
  const path = await getDesktopWorkspacePath();
  renderDesktopChatRail(path);
}

/** Reset rail UI state (tests). */
export function resetDesktopChatRailForTests(): void {
  railExpanded = false;
  mountExpertScopeInRail(false);
  syncRailClasses();
  if (mobileMq && mobileMqListener) {
    mobileMq.removeEventListener('change', mobileMqListener);
    mobileMq = null;
    mobileMqListener = null;
  }
}
