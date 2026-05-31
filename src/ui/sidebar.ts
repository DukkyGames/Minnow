import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';
import { isChatStreaming } from '../chat/streaming-state';
import { syncComposerFromStreamingState } from './composer-send';
import {
  createEmptyChatObject,
  getActiveChat,
  getChatsForWorkspace,
  getUnassignedChats,
  onWorkspaceChanged,
  sessionState,
  touchChat,
  recordChatMessage,
  scheduleSaveSessions,
} from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import type { Chat } from '../types';
import {
  applySidebarVisuals,
  closeMobileSidebar,
} from './layout';
import { bootGenerationResumeForChat } from '../chat/generation-resume';
import {
  renderChatFromHistory,
  renderStatsForChat,
  showCachedModelInfo,
} from './messages';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncModeSelectorFromActiveChat } from './mode-selector';
import { syncThinkingControlFromActiveChat } from './composer-thinking';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncComposerPinnedSkillFromActiveChat } from './composer-pinned-skill';
import { buildDefaultPinnedSkillForNewChat } from '../skills/config';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import { onModelRoutingActiveChatChanged } from './settings-model-routing';
import { syncReefWidgetSettingsFromActiveChat } from './reef-widget-settings';
import { syncWorkAgentDevFromActiveChat, workAgentSidebarAbbrev } from './work-agent-dev';
import { updateModelLoadUnloadButtons } from '../api/models';
import { updateModelStateDot } from './model-state-dot';
import { syncModelSelectPicker } from './model-select-picker';
import { setStatus } from './status';
import { formatSidebarStatsPreview } from './stats';
import { refreshTerminalHistoryForActiveChat } from './terminal-panel';
import {
  applyChatItemDotClasses,
  getChatItemDotContext,
  maybeMarkChatUnreadAfterLeave,
  recordChatOpened,
  resolveChatItemDotState,
  syncChatItemDotsInDom,
} from './chat-item-dot';

/** Read canonical model id + optional provider from the top-bar composite select value. */
function readTopBarModelBinding(): { modelId: string; providerId?: string } {
  const raw = (document.getElementById('modelSelect') as HTMLSelectElement)?.value ?? '';
  const parsed = decodeModelSelectKey(raw);
  const modelId = (parsed?.modelId ?? raw).trim();
  return { modelId, providerId: parsed?.providerId };
}

/** Keep model picker aligned with the active chat's stored model id. */
export function syncModelSelectForActiveChat(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const chat = getActiveChat();
  if (!sel || !sel.options.length) return;
  const opts = [...sel.options];
  const values = opts.map((o) => o.value);
  const pid = chat.providerId?.trim();
  const mid = chat.modelId?.trim();
  if (pid && mid) {
    const want = encodeModelSelectKey(pid, mid);
    if (values.includes(want)) sel.value = want;
  }
  if (!sel.value && mid) {
    const match = opts.find(
      (o) => decodeModelSelectKey(o.value)?.modelId === mid || o.value === mid,
    );
    if (match) sel.value = match.value;
  }
  updateModelStateDot(sel.value);
  updateModelLoadUnloadButtons();
  syncModelSelectPicker();
}

export function onModelSelectChange(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const chat = getActiveChat();
  const raw = sel.value;
  const decoded = decodeModelSelectKey(raw);
  if (decoded) {
    chat.providerId = decoded.providerId;
    chat.modelId = decoded.modelId;
  } else {
    chat.modelId = raw;
  }
  touchChat(chat);
  scheduleSaveSessions();
  updateModelStateDot(sel.value);
  updateModelLoadUnloadButtons();
  syncModelSelectPicker();
  showCachedModelInfo();
}

/** Refresh main column after workspace folder changes. */
export function applyWorkspaceScopedSession(newPath: string, previousPath?: string): void {
  const { activeChat, activeChanged } = onWorkspaceChanged(newPath, previousPath);
  if (activeChanged) {
    recordChatOpened(activeChat.id);
    syncModelSelectForActiveChat();
    renderChatFromHistory(activeChat);
    renderStatsForChat(activeChat);
    syncModeSelectorFromActiveChat();
    syncThinkingControlFromActiveChat();
    void syncOrchestratePlanStripFromActiveChat();
    syncComposerPinnedSkillFromActiveChat();
    syncViewModeToggleFromActiveChat();
    syncWorkAgentDevFromActiveChat();
    syncReefWidgetSettingsFromActiveChat();
    onModelRoutingActiveChatChanged(activeChat.id);
    void refreshTerminalHistoryForActiveChat();
  }
  renderSidebar();
  if (document.getElementById('globalBugsView')?.classList.contains('is-open')) {
    void import('./global-bugs-page').then((m) => m.renderGlobalBugsList());
  }
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
    appendChatRow(list, chat, activeId);
  }
}

function appendChatRow(list: HTMLElement, chat: Chat, activeId: string | null): void {
  const isActive = chat.id === activeId;
  const modelLabel = chat.modelId || 'No model selected';
  const statsPreview = formatSidebarStatsPreview(chat.lastStats);
  const rowLabel = `${chat.name}, ${modelLabel}${statsPreview ? `, ${statsPreview}` : ''}`;

  const row = document.createElement('div');
  row.dataset.chatId = chat.id;
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
  const dotCtx = getChatItemDotContext(activeId);
  applyChatItemDotClasses(dot, resolveChatItemDotState(chat, dotCtx), row);
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
  renameBtn.textContent = '\u270E';
  renameBtn.setAttribute('aria-label', `Rename chat: ${chat.name}`);
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginRenameChat(chat.id, nameSpan, renameBtn, deleteBtn, actions);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'chat-delete-btn';
  deleteBtn.textContent = '\u{1F5D1}';
  deleteBtn.setAttribute('aria-label', `Delete chat: ${chat.name}`);
  deleteBtn.addEventListener('click', (e) => deleteChat(chat.id, e));

  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  head.appendChild(titleRow);
  head.appendChild(actions);

  const modelEl = document.createElement('div');
  modelEl.className = 'chat-item-model';
  modelEl.textContent = chat.modelId || '\u2014';

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
    appendChatRow(list, chat, sessionState.activeId);
  }

  const unassigned = getUnassignedChats(sessionState);
  appendChatListSection(list, 'Unassigned', unassigned, sessionState.activeId);
  syncChatItemDotsInDom();
  void import('./global-bugs-page').then((m) => m.refreshGlobalBugsSidebarBadge());
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
  if (isChatStreaming(chatId)) {
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
    const { modelId, providerId } = readTopBarModelBinding();
    const fresh = createEmptyChatObject(modelId, victimWorkspace);
    if (providerId) fresh.providerId = providerId;
    sessionState!.chats.push(fresh);
    sessionState!.activeId = fresh.id;
    touchChat(fresh);
    mainNeedsRefresh = true;
  } else if (wasActive) {
    const inWorkspace = getChatsForWorkspace(victimWorkspace, sessionState!);
    if (inWorkspace.length) {
      sessionState!.activeId = inWorkspace[0].id;
    } else {
      const { modelId, providerId } = readTopBarModelBinding();
      const fresh = createEmptyChatObject(modelId, victimWorkspace);
      if (providerId) fresh.providerId = providerId;
      sessionState!.chats.push(fresh);
      sessionState!.activeId = fresh.id;
      touchChat(fresh);
    }
    mainNeedsRefresh = true;
  }

  if (mainNeedsRefresh) {
    const active = getActiveChat();
    recordChatOpened(active.id);
    syncModelSelectForActiveChat();
    renderChatFromHistory(active);
    renderStatsForChat(active);
  }
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
}

export function switchChat(id: string): void {
  if (!sessionState || id === sessionState.activeId) {
    closeMobileSidebar();
    applySidebarVisuals();
    return;
  }
  const prevActiveId = sessionState.activeId;
  const leaving = prevActiveId
    ? sessionState.chats.find((c) => c.id === prevActiveId)
    : undefined;
  if (leaving) {
    maybeMarkChatUnreadAfterLeave(leaving);
  }
  const chat = sessionState.chats.find((c) => c.id === id);
  if (!chat) return;
  sessionState.activeId = id;
  chat.unread = false;
  recordChatOpened(id);
  syncModelSelectForActiveChat();
  renderChatFromHistory(chat);
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncThinkingControlFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  onModelRoutingActiveChatChanged(chat.id);
  void refreshTerminalHistoryForActiveChat();
  syncComposerFromStreamingState();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(id));
}

export interface CreateChatWithModeOptions {
  modeId: ModeId;
  orchestratePlanPath?: string;
  initialUserMessage?: string;
}

export interface CreateChatWithModeResult {
  ok: boolean;
  chatId?: string;
  modeId?: ModeId;
  orchestratePlanPath?: string;
  error?: string;
}

/** Create and activate a chat with a preset operating mode (tool handoff). */
export function createChatWithMode(
  options: CreateChatWithModeOptions,
): CreateChatWithModeResult {
  const modeId = normalizeModeId(options.modeId);
  const { modelId, providerId } = readTopBarModelBinding();
  const chat = createEmptyChatObject(modelId);
  if (providerId) chat.providerId = providerId;
  chat.modeId = modeId;
  if (chat.workAgentAuto !== false) {
    const agent = getDefaultWorkAgentForMode(modeId);
    chat.workAgentId = agent?.id ?? null;
  }

  const defaultPin = buildDefaultPinnedSkillForNewChat();
  if (defaultPin) {
    chat.pinnedSkill = defaultPin;
  }

  const planPath = options.orchestratePlanPath?.trim();
  if (planPath) {
    const normalized = normalizeOrchestratePlanPath(planPath);
    if (normalized) chat.orchestratePlanPath = normalized;
  }

  const initial = options.initialUserMessage?.trim();
  if (initial) {
    chat.history.push({ role: 'user', content: initial });
    recordChatMessage(chat);
  }

  sessionState!.chats.unshift(chat);
  sessionState!.activeId = chat.id;
  if (!initial) touchChat(chat);
  recordChatOpened(chat.id);
  renderChatFromHistory(chat);
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncThinkingControlFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  onModelRoutingActiveChatChanged(chat.id);
  void refreshTerminalHistoryForActiveChat();
  syncComposerFromStreamingState();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();

  return {
    ok: true,
    chatId: chat.id,
    modeId,
    orchestratePlanPath: chat.orchestratePlanPath,
  };
}

export function createChat(): void {
  createChatWithMode({ modeId: normalizeModeId(getActiveChat().modeId) });
}
