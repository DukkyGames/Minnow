import { streaming } from '../app-state';
import {
  createEmptyChatObject,
  getActiveChat,
  getChatsForWorkspace,
  getUnassignedChats,
  onWorkspaceChanged,
  sessionState,
  touchChat,
  scheduleSaveSessions,
} from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import type { Chat } from '../types';
import {
  applySidebarVisuals,
  closeMobileSidebar,
} from './layout';
import { initPendingTurnRecoveryForChat } from './pending-turn-recovery';
import {
  renderChatFromHistory,
  renderStatsForChat,
  showCachedModelInfo,
} from './messages';
import { syncExpertSelectForActiveChat } from './expert-select';
import { syncModeSelectorFromActiveChat } from './mode-selector';
import { syncWorkAgentDevFromActiveChat, workAgentSidebarAbbrev } from './work-agent-dev';
import { updateModelLoadUnloadButtons } from '../api/models';
import { updateModelStateDot } from './model-state-dot';
import { setStatus } from './status';
import { formatSidebarStatsPreview } from './stats';
import { refreshTerminalHistoryForActiveChat } from './terminal-panel';

/** Keep model picker aligned with the active chat's stored model id. */
export function syncModelSelectForActiveChat(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const chat = getActiveChat();
  if (!sel || !sel.options.length) return;
  const opts = [...sel.options].map((o) => o.value);
  if (chat.modelId && opts.includes(chat.modelId)) sel.value = chat.modelId;
  updateModelStateDot(sel.value);
  updateModelLoadUnloadButtons();
}

export function onModelSelectChange(): void {
  const chat = getActiveChat();
  chat.modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  touchChat(chat);
  scheduleSaveSessions();
  updateModelStateDot(chat.modelId);
  updateModelLoadUnloadButtons();
  showCachedModelInfo();
}

/** Refresh main column after workspace folder changes. */
export function applyWorkspaceScopedSession(newPath: string, previousPath?: string): void {
  const { activeChat, activeChanged } = onWorkspaceChanged(newPath, previousPath);
  if (activeChanged) {
    syncModelSelectForActiveChat();
    renderChatFromHistory(activeChat);
    renderStatsForChat(activeChat);
    syncModeSelectorFromActiveChat();
    syncExpertSelectForActiveChat();
    syncWorkAgentDevFromActiveChat();
    void refreshTerminalHistoryForActiveChat();
  }
  renderSidebar();
}

function appendChatListSection(
  list: HTMLElement,
  title: string,
  chats: Chat[],
  activeId: string | null,
): void {
  if (!chats.length) return;

  const head = document.createElement('div');
  head.className = 'chat-list-section-head';
  head.setAttribute('role', 'presentation');

  const titleEl = document.createElement('span');
  titleEl.className = 'chat-list-section-title';
  titleEl.textContent = title;
  head.appendChild(titleEl);

  const badge = document.createElement('span');
  badge.className = 'chat-list-section-badge';
  badge.textContent = String(chats.length);
  badge.setAttribute('aria-hidden', 'true');
  head.appendChild(badge);

  list.appendChild(head);

  for (const chat of chats) {
    appendChatRow(list, chat, chat.id === activeId);
  }
}

function appendChatRow(list: HTMLElement, chat: Chat, isActive: boolean): void {
  const modelLabel = chat.modelId || 'No model selected';
  const statsPreview = formatSidebarStatsPreview(chat.lastStats);
  const rowLabel = `${chat.name}, ${modelLabel}${statsPreview ? `, ${statsPreview}` : ''}`;

  const row = document.createElement('div');
  row.className = 'chat-item-row' + (isActive ? ' active' : '');
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-label', rowLabel);
  row.title = [chat.name, modelLabel, statsPreview].filter(Boolean).join('\n');
  row.tabIndex = 0;
  row.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.chat-item-actions')) return;
    switchChat(chat.id);
  });
  row.addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('.chat-item-actions')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchChat(chat.id);
    }
  });

  const head = document.createElement('div');
  head.className = 'chat-item-head';

  const titleRow = document.createElement('div');
  titleRow.className = 'chat-item-title-row';

  const dot = document.createElement('div');
  dot.className = 'chat-item-dot';
  dot.setAttribute('aria-hidden', 'true');
  titleRow.appendChild(dot);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-item-name';
  nameSpan.textContent = chat.name;
  titleRow.appendChild(nameSpan);

  const agentAbbrev = workAgentSidebarAbbrev(chat.workAgentId);
  if (agentAbbrev) {
    const badge = document.createElement('span');
    badge.className = 'chat-item-agent-badge';
    badge.textContent = agentAbbrev;
    badge.title = `Work agent: ${chat.workAgentId}`;
    titleRow.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'chat-item-actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'chat-rename-btn';
  renameBtn.textContent = '✎';
  renameBtn.setAttribute('aria-label', `Rename chat: ${chat.name}`);
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginRenameChat(chat.id, nameSpan, renameBtn, deleteBtn, actions);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'chat-delete-btn';
  deleteBtn.textContent = '🗑';
  deleteBtn.setAttribute('aria-label', `Delete chat: ${chat.name}`);
  deleteBtn.addEventListener('click', (e) => deleteChat(chat.id, e));

  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  head.appendChild(titleRow);
  head.appendChild(actions);

  const modelEl = document.createElement('div');
  modelEl.className = 'chat-item-model';
  modelEl.textContent = chat.modelId || '—';

  const statsEl = document.createElement('div');
  statsEl.className = 'chat-item-stats';
  statsEl.textContent = formatSidebarStatsPreview(chat.lastStats);

  row.appendChild(head);
  row.appendChild(modelEl);
  row.appendChild(statsEl);
  list.appendChild(row);
}

/** Rebuild the session list in the left sidebar (workspace-scoped + Unassigned). */
export function renderSidebar(): void {
  const list = document.getElementById('chatList');
  if (!list || !sessionState) return;
  list.innerHTML = '';

  const workspaceChats = getChatsForWorkspace(getWorkspacePath(), sessionState);
  for (const chat of workspaceChats) {
    appendChatRow(list, chat, chat.id === sessionState.activeId);
  }

  const unassigned = getUnassignedChats(sessionState);
  appendChatListSection(list, 'Unassigned', unassigned, sessionState.activeId);
}

function beginRenameChat(
  chatId: string,
  nameSpan: HTMLSpanElement,
  renameBtn: HTMLButtonElement,
  deleteBtn: HTMLButtonElement,
  actionsEl: HTMLDivElement
): void {
  const chat = sessionState!.chats.find((c) => c.id === chatId);
  if (!chat) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'chat-rename-input';
  inp.value = chat.name;
  inp.maxLength = 120;
  inp.setAttribute('aria-label', 'Chat title');
  nameSpan.replaceWith(inp);
  actionsEl.style.visibility = 'hidden';
  inp.focus();
  inp.select();

  const finish = () => {
    const v = inp.value.trim();
    if (v) chat.name = v;
    inp.replaceWith(nameSpan);
    nameSpan.textContent = chat.name;
    actionsEl.style.visibility = '';
    touchChat(chat);
    renderSidebar();
    scheduleSaveSessions();
  };

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.blur();
    }
    if (e.key === 'Escape') {
      inp.value = chat.name;
      inp.blur();
    }
  });
  inp.addEventListener('blur', finish, { once: true });
}

export function deleteChat(chatId: string, evt?: Event): void {
  if (evt) evt.stopPropagation();
  if (streaming) {
    setStatus('spin', 'Finish the current reply first');
    return;
  }
  const idx = sessionState!.chats.findIndex((c) => c.id === chatId);
  if (idx < 0) return;
  const victim = sessionState!.chats[idx];
  if (!confirm(`Delete "${victim.name}"? Messages in this chat cannot be recovered.`)) return;

  const wasActive = sessionState!.activeId === chatId;
  sessionState!.chats.splice(idx, 1);

  const victimWorkspace = victim.workspacePath ?? '';
  let mainNeedsRefresh = wasActive;
  if (sessionState!.chats.length === 0) {
    const modelId =
      (document.getElementById('modelSelect') as HTMLSelectElement).value || '';
    const fresh = createEmptyChatObject(modelId, victimWorkspace);
    sessionState!.chats.push(fresh);
    sessionState!.activeId = fresh.id;
    touchChat(fresh);
    mainNeedsRefresh = true;
  } else if (wasActive) {
    const inWorkspace = getChatsForWorkspace(victimWorkspace, sessionState!);
    if (inWorkspace.length) {
      sessionState!.activeId = inWorkspace[0].id;
    } else {
      const modelId =
        (document.getElementById('modelSelect') as HTMLSelectElement).value || '';
      const fresh = createEmptyChatObject(modelId, victimWorkspace);
      sessionState!.chats.push(fresh);
      sessionState!.activeId = fresh.id;
      touchChat(fresh);
    }
    mainNeedsRefresh = true;
  }

  if (mainNeedsRefresh) {
    const active = getActiveChat();
    syncModelSelectForActiveChat();
    renderChatFromHistory(active);
    renderStatsForChat(active);
  }
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
}

export function switchChat(id: string): void {
  if (streaming) {
    setStatus('spin', 'Finish the current reply first');
    return;
  }
  if (!sessionState || id === sessionState.activeId) {
    closeMobileSidebar();
    applySidebarVisuals();
    return;
  }
  const chat = sessionState.chats.find((c) => c.id === id);
  if (!chat) return;
  sessionState.activeId = id;
  syncModelSelectForActiveChat();
  renderChatFromHistory(chat);
  initPendingTurnRecoveryForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncExpertSelectForActiveChat();
  syncWorkAgentDevFromActiveChat();
  void refreshTerminalHistoryForActiveChat();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();
}

export function createChat(): void {
  if (streaming) {
    setStatus('spin', 'Finish the current reply first');
    return;
  }
  const modelId =
    (document.getElementById('modelSelect') as HTMLSelectElement).value || '';
  const chat = createEmptyChatObject(modelId);
  sessionState!.chats.unshift(chat);
  sessionState!.activeId = chat.id;
  touchChat(chat);
  renderChatFromHistory(chat);
  initPendingTurnRecoveryForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncExpertSelectForActiveChat();
  void refreshTerminalHistoryForActiveChat();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();
}
