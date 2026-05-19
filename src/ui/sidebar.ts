import { streaming } from '../app-state';
import {
  createEmptyChatObject,
  getActiveChat,
  sessionState,
  touchChat,
  scheduleSaveSessions,
} from '../state/sessions';
import {
  applySidebarVisuals,
  closeMobileSidebar,
} from './layout';
import {
  renderChatFromHistory,
  renderStatsForChat,
  showCachedModelInfo,
} from './messages';
import { syncExpertSelectForActiveChat } from './expert-select';
import { syncModeSelectorFromActiveChat } from './mode-selector';
import { syncWorkAgentDevFromActiveChat, workAgentSidebarAbbrev } from './work-agent-dev';
import { setStatus } from './status';
import { formatSidebarStatsPreview } from './stats';

/** Keep model picker aligned with the active chat's stored model id. */
export function syncModelSelectForActiveChat(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const chat = getActiveChat();
  if (!sel || !sel.options.length) return;
  const opts = [...sel.options].map((o) => o.value);
  if (chat.modelId && opts.includes(chat.modelId)) sel.value = chat.modelId;
}

export function onModelSelectChange(): void {
  const chat = getActiveChat();
  chat.modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  touchChat(chat);
  scheduleSaveSessions();
  showCachedModelInfo();
}

/** Rebuild the session list in the left sidebar. */
export function renderSidebar(): void {
  const list = document.getElementById('chatList');
  if (!list || !sessionState) return;
  list.innerHTML = '';
  const sorted = [...sessionState.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const chat of sorted) {
    const isActive = chat.id === sessionState.activeId;
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

  let mainNeedsRefresh = wasActive;
  if (sessionState!.chats.length === 0) {
    const modelId =
      (document.getElementById('modelSelect') as HTMLSelectElement).value || '';
    const fresh = createEmptyChatObject(modelId);
    sessionState!.chats.push(fresh);
    sessionState!.activeId = fresh.id;
    touchChat(fresh);
    mainNeedsRefresh = true;
  } else if (wasActive) {
    sessionState!.activeId = [...sessionState!.chats].sort(
      (a, b) => b.updatedAt - a.updatedAt
    )[0].id;
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
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncExpertSelectForActiveChat();
  syncWorkAgentDevFromActiveChat();
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
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncExpertSelectForActiveChat();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();
}
