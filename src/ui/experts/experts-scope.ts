/**
 * Expert-scoped chat shell: sidebar persona header and active expert id.
 */

import { getExpert } from '../../chat/experts/registry';
import type { ExpertAccent, ExpertMeta } from '../../chat/experts/types';
import { bootGenerationResumeForChat } from '../../chat/generation-resume';
import { setExpertsPageOpen } from '../../app-state';
import { activateChatById, getExpertChats } from '../../state/sessions';
import type { Chat } from '../../types';
import { recordChatOpened } from '../chat-item-dot';
import { renderChatFromHistory, renderStatsForChat } from '../messages';
import { syncModelSelectForActiveChat } from '../sidebar';
import { syncComposerFromStreamingState } from '../composer-send';
import { syncModeSelectorFromActiveChat } from '../mode-selector';

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
  if (!expert) return;
  const accent = expertAccent(expert.meta);
  if (iconEl) {
    iconEl.textContent = expertIcon(expert.meta);
    applyAccentToElement(iconEl, accent);
  }
  if (titleEl) titleEl.textContent = expert.meta.label;
}

function formatScopeChatTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

/** Rebuild expert-scoped chat rows in the sidebar. */
export function renderExpertScopeChatList(expertId: string, activeChatId: string): void {
  const list = document.getElementById('expertScopeChatList');
  if (!list) return;
  list.replaceChildren();
  for (const chat of getExpertChats(expertId)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-item';
    if (chat.id === activeChatId) btn.classList.add('active');
    btn.dataset.chatId = chat.id;

    const name = document.createElement('span');
    name.className = 'chat-item-name';
    name.textContent = chat.name;

    const time = document.createElement('span');
    time.className = 'chat-item-time';
    time.textContent = formatScopeChatTime(chat.lastMessageAt ?? chat.updatedAt);

    btn.appendChild(name);
    btn.appendChild(time);
    btn.addEventListener('click', () => {
      void openExpertChatInShell(chat);
    });
    list.appendChild(btn);
  }
}

/** Activate chat in expert-scoped shell (sidebar + main column). */
export async function openExpertChatInShell(chat: Chat): Promise<void> {
  const expertId =
    chat.expertId?.trim() || chat.expertSelection?.expertId?.trim() || null;
  if (!expertId) return;

  const root = document.getElementById('expertsView');
  const shell = document.getElementById('appBody');
  if (!root || !shell) return;

  setExpertScopeId(expertId);
  syncExpertScopeChromeDataset();
  setExpertScopeSidebarVisible(true);
  renderExpertScopeHeader(expertId);

  setExpertsPageOpen(false);
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  document.querySelector('header.topbar')?.classList.remove('hidden');

  activateChatById(chat.id);
  recordChatOpened(chat.id);
  syncModelSelectForActiveChat();
  renderChatFromHistory(chat);
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncComposerFromStreamingState();
  renderExpertScopeChatList(expertId, chat.id);
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
}
