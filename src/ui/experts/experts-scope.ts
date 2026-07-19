/**
 * Expert-scoped chat shell: sidebar persona header and active expert id.
 */

import { getExpert } from '../../chat/experts/registry';
import type { ExpertAccent, ExpertMeta } from '../../chat/experts/types';
import { bootGenerationResumeForChat } from '../../chat/generation-resume';
import { resumeIncompleteToolBatchOnChatSwitch } from '../../chat/incomplete-tool-resume';
import { setExpertsPageOpen } from '../../app-state';
import { activateChatById, getExpertChats } from '../../state/sessions';
import type { Chat } from '../../types';
import { recordChatOpened, syncChatItemDotsInDom } from '../chat-item-dot';
import { appendChatRow } from '../sidebar';
import { renderChatFromHistory, renderStatsForChat } from '../messages';
import { syncComposerFromStreamingState } from '../composer-send';
import { syncModeSelectorFromActiveChat } from '../mode-selector';
import { syncModelSelectForActiveChat } from '../sidebar';
import { isOsShellEnabled } from '../../os/page-bridge';

let expertScopeId: string | null = null;

export function getExpertScopeId(): string | null {
  return expertScopeId;
}

export function setExpertScopeId(expertId: string | null): void {
  expertScopeId = expertId?.trim() || null;
}

export function isExpertScopeActive(): boolean {
  return expertScopeId != null;
}

export function syncExpertScopeChromeDataset(): void {
  const body = document.getElementById('appBody');
  if (!body) return;
  if (expertScopeId) {
    body.dataset.scope = 'expert';
    body.dataset.expertId = expertScopeId;
  } else {
    delete body.dataset.scope;
    delete body.dataset.expertId;
  }
}

export function setExpertScopeSidebarVisible(visible: boolean): void {
  const sidebar = document.getElementById('chatSidebar');
  const main = document.getElementById('chatSidebarMain');
  const scope = document.getElementById('expertScopeChrome');
  if (!sidebar || !main || !scope) return;
  sidebar.classList.toggle('chat-sidebar--expert-scope', visible);
  main.hidden = visible;
  scope.hidden = !visible;
  scope.classList.toggle('hidden', !visible);
}

function expertIcon(meta: ExpertMeta): string {
  const icon = meta.icon?.trim();
  return icon || meta.label.charAt(0).toUpperCase();
}

function expertAccent(meta: ExpertMeta): ExpertAccent {
  return meta.accent ?? 'sage';
}

function accentClassName(accent: ExpertAccent): string {
  return `expert-accent-${accent}`;
}

function applyAccentToElement(el: HTMLElement, accent: ExpertAccent): void {
  el.classList.remove(
    'expert-accent-sage',
    'expert-accent-amber',
    'expert-accent-cyan',
    'expert-accent-coral',
    'expert-accent-violet',
    'expert-accent-rose',
  );
  el.classList.add(accentClassName(accent));
}

/** Update scoped sidebar header (icon, title, accent). */
export function renderExpertScopeHeader(expertId: string): void {
  const expert = getExpert(expertId);
  const iconEl = document.getElementById('expertScopeIcon');
  const titleEl = document.getElementById('expertScopeTitle');
  const identityEl = document.getElementById('expertScopeIdentity');
  if (!expert) return;
  const accent = expertAccent(expert.meta);
  if (iconEl) {
    iconEl.textContent = expertIcon(expert.meta);
  }
  if (titleEl) titleEl.textContent = expert.meta.label;
  if (identityEl) applyAccentToElement(identityEl, accent);
}

/** Rebuild expert-scoped chat rows in the sidebar. */
export function renderExpertScopeChatList(expertId: string, activeChatId: string): void {
  const list = document.getElementById('expertScopeChatList');
  if (!list) return;
  list.replaceChildren();
  for (const chat of getExpertChats(expertId)) {
    appendChatRow(list, chat, activeChatId, { draggable: false });
  }
  syncChatItemDotsInDom();
}

/** Activate chat in expert-scoped shell (sidebar + main column). */
export async function openExpertChatInShell(chat: Chat): Promise<void> {
  const expertId =
    chat.expertId?.trim() || chat.expertSelection?.expertId?.trim() || null;
  if (!expertId) return;

  const root = document.getElementById('expertsView');
  const shell = document.getElementById('appBody');
  if (!root || !shell) return;

  setExpertsPageOpen(false);
  root.classList.remove('is-open');

  const { abandonExpertsHubSavedChat } = await import('./experts-hub');
  abandonExpertsHubSavedChat();

  activateChatById(chat.id);
  recordChatOpened(chat.id);
  syncModelSelectForActiveChat();
  void bootGenerationResumeForChat(chat);
  void resumeIncompleteToolBatchOnChatSwitch(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncComposerFromStreamingState();

  if (isOsShellEnabled()) {
    const { activateDesktopChat } = await import('../../os/desktop-state');
    await activateDesktopChat({ chatId: chat.id });
    renderChatFromHistory(chat, '#desktopChatCol');
    const { refreshDesktopChatRail } = await import('../desktop-chat-rail');
    await refreshDesktopChatRail();
  } else {
    setExpertScopeId(expertId);
    syncExpertScopeChromeDataset();
    setExpertScopeSidebarVisible(true);
    renderExpertScopeHeader(expertId);
    shell.classList.remove('hidden');
    document.querySelector('header.topbar')?.classList.remove('hidden');
    renderChatFromHistory(chat);
    renderExpertScopeChatList(expertId, chat.id);
  }

  void import('../../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chat.id));
  void import('../preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

/** Leave expert-scoped shell; caller opens the hub. */
export function teardownExpertScopeShell(): void {
  setExpertScopeId(null);
  syncExpertScopeChromeDataset();
  setExpertScopeSidebarVisible(false);
  const shell = document.getElementById('appBody');
  if (shell) {
    delete shell.dataset.scope;
    delete shell.dataset.expertId;
  }
  void import('../desktop-chat-rail').then((m) => m.clearDesktopExpertScopeRail());
}
